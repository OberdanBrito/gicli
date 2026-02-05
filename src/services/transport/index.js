// import { SQLiteDriver } from './drivers/sqlite.js'; // Temporariamente removido para compatibilidade com Node.js
import { SQLServerDriver } from './drivers/sqlserver.js';

/**
 * Serviço de Transporte para Banco de Dados
 * Gerencia a persistência de dados em diferentes bancos usando drivers
 */
class TransportService {
  constructor() {
    this.drivers = {
      // sqlite: SQLiteDriver, // Temporariamente removido para compatibilidade com Node.js
      sqlserver: SQLServerDriver
    };
    this.activeDriver = null;
    this.connected = false;
  }

  /**
   * Conecta ao banco usando o driver especificado
   * @param {string} driverName - Nome do driver (sqlite, sqlserver)
   * @param {string} connectionString - String de conexão
   */
  async connect(driverName, connectionString) {
    if (!this.drivers[driverName]) {
      throw new Error(`Driver '${driverName}' não suportado. Drivers disponíveis: ${Object.keys(this.drivers).join(', ')}`);
    }

    try {
      this.activeDriver = new (this.drivers[driverName])();
      await this.activeDriver.connect(connectionString);
      this.connected = true;
      console.log(`Transporte conectado via driver ${driverName}`);
    } catch (error) {
      console.error(`Erro ao conectar transporte ${driverName}:`, error.message);
      throw error;
    }
  }

  /**
   * Desconecta do banco
   */
  async disconnect() {
    if (this.activeDriver && this.connected) {
      await this.activeDriver.disconnect();
      this.activeDriver = null;
      this.connected = false;
      console.log('Transporte desconectado');
    }
  }

  /**
   * Processa saída para banco de dados
   * @param {object} responseData - Dados da resposta da API
   * @param {object} outputConfig - Configuração de saída
   * @param {object} metadata - Metadados adicionais (timestamp, jobId, etc.)
   * @param {object} originConfig - Configuração da origem (para herdar connection_string)
   */
  async processDatabaseOutput(responseData, outputConfig, metadata = {}, originConfig = {}) {
    console.log('=== PROCESS DATABASE OUTPUT STARTED ===');
    
    if (!this.connected || !this.activeDriver) {
      throw new Error('Transporte não conectado ao banco de dados');
    }

    const { driver, table, columns = {}, data_path, clear_before_insert = false, connection_string } = outputConfig;
    
    // Usa connection_string do job ou fallback para connection_string da origem
    const finalConnectionString = connection_string || originConfig.connection_string;
    
    if (!finalConnectionString) {
      throw new Error('Connection string não encontrada no job nem na origem');
    }

    try {
      // Extrai dados do caminho especificado, se definido
      let dataToProcess = responseData;
      if (data_path) {
        dataToProcess = this.extractValue(responseData, data_path);
        if (dataToProcess === undefined) {
          console.warn(`Caminho '${data_path}' não encontrado na resposta. Usando resposta completa.`);
        }
      }
      
      // Converte objeto com chaves numéricas para array
      if (dataToProcess && typeof dataToProcess === 'object' && !Array.isArray(dataToProcess)) {
        const keys = Object.keys(dataToProcess);
        if (keys.length > 0 && keys.every(k => /^\d+$/.test(k))) {
          console.log(`Convertendo objeto com chaves numéricas para array (${keys.length} itens)`);
          dataToProcess = Object.values(dataToProcess);
        }
      }
      console.log(`DEBUG PROCESS - Tipo de dados: ${Array.isArray(dataToProcess) ? `Array[${dataToProcess.length}]` : typeof dataToProcess}`);

      let recordsInserted = 0;
      let hasIdColumn = false;

      // Verifica se os dados têm coluna ID própria
      if (Array.isArray(dataToProcess) && dataToProcess.length > 0) {
        hasIdColumn = this.hasIdColumn(dataToProcess[0]);
      } else if (dataToProcess && typeof dataToProcess === 'object') {
        hasIdColumn = this.hasIdColumn(dataToProcess);
      }

      console.log(`Dados ${hasIdColumn ? 'TÊM' : 'NÃO TÊM'} coluna ID própria`);

      // Verifica se os dados extraídos são um array
      if (Array.isArray(dataToProcess)) {
        if (dataToProcess.length === 0) {
          console.log('Array vazio recebido, nenhum registro para inserir');
          return {
            success: true,
            table,
            recordsInserted: 0,
            message: 'Array vazio'
          };
        }

        console.log(`Processando array com ${dataToProcess.length} itens`);
        console.log(`=== INICIANDO LOOP DE INSERÇÃO ===`);

        // Processa cada item do array
        for (let i = 0; i < dataToProcess.length; i++) {
          const item = dataToProcess[i];

          // Prepara dados para inserção
          const dataToInsert = this.prepareDataForInsert(item, columns, {
            ...metadata,
            arrayIndex: i
          });

          // Garante que a tabela existe (apenas na primeira iteração)
          if (i === 0) {
            // Se clear_before_insert, força recriação da tabela para schema correto
            if (clear_before_insert) {
              console.log(`Forçando recriação da tabela [${table}] para schema correto`);
              await this.activeDriver.query(`DROP TABLE IF EXISTS [${table}]`);
            }
            
            await this.ensureTable(table, dataToInsert, hasIdColumn);
            
            // Limpa tabela antes da inserção se solicitado
            if (clear_before_insert) {
              console.log(`Preparando a tabela [${table}]`);
              await this.activeDriver.clearTable(table);
            }
          }

          try {
            // Insere os dados
            const insertId = await this.activeDriver.insert(table, dataToInsert, hasIdColumn);
            recordsInserted++;

            if (i > 0 && i % 10 === 0) {
              console.log(`Inseridos ${i} registros...`);
            }
          } catch (insertError) {
            console.error(`Erro ao inserir registro ${i} (id: ${item.id || 'N/A'}):`, insertError.message);
            console.error('Dados do registro problemático:', JSON.stringify(item, null, 2));
            // Continua processando os demais registros
          }
        }

        console.log(`Total de registros inseridos: ${recordsInserted}`);

      } else {
        // Processa objeto único (comportamento original)
        const dataToInsert = this.prepareDataForInsert(dataToProcess, columns, metadata);

        // Garante que a tabela existe
        await this.ensureTable(table, dataToInsert, hasIdColumn);

        // Insere os dados
        const insertId = await this.activeDriver.insert(table, dataToInsert, hasIdColumn);
        recordsInserted = 1;
      }

      return {
        success: true,
        table,
        insertId: recordsInserted > 0 ? 'multiple' : undefined,
        recordsInserted
      };

    } catch (error) {
      console.error('Erro no processamento de saída para banco:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Prepara dados para inserção baseado no mapeamento de colunas
   * @param {any} responseData - Dados da resposta
   * @param {object} columnMapping - Mapeamento campo -> coluna
   * @param {object} metadata - Metadados
   * @returns {object} Dados preparados
   */
  prepareDataForInsert(responseData, columnMapping, metadata) {
    const data = {};

    // Se columnMapping estiver vazio, usa estrutura plana
    if (Object.keys(columnMapping).length === 0) {
      if (typeof responseData === 'object' && responseData !== null) {
        // Serializa arrays/objetos automaticamente
        for (const [key, value] of Object.entries(responseData)) {
          // Pula campos que conflitam com colunas automáticas do sistema
          if (key === 'created_at' || key === 'updated_at') {
            continue;
          }
          
          if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
            data[key] = JSON.stringify(value);
          } else {
            data[key] = value;
          }
        }
      } else {
        data.response = responseData;
      }
    } else {
      // Usa mapeamento personalizado
      for (const [field, column] of Object.entries(columnMapping)) {
        const value = this.extractValue(responseData, field);
        // Serializa arrays/objetos automaticamente
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          data[column] = JSON.stringify(value);
        } else {
          data[column] = value;
        }
      }
    }

    // Adiciona metadados se colunas correspondentes existirem
    if (metadata.jobId && !data.job_id) data.job_id = metadata.jobId;
    if (metadata.timestamp && !data.timestamp) data.timestamp = metadata.timestamp;
    if (metadata.originName && !data.origin) data.origin = metadata.originName;

    return data;
  }

  /**
   * Extrai valor de estrutura aninhada
   * @param {any} obj - Objeto
   * @param {string} path - Caminho (ex: "data.user.name")
   * @returns {any} Valor extraído
   */
  extractValue(obj, path) {
    if (!path.includes('.')) {
      return obj && typeof obj === 'object' ? obj[path] : undefined;
    }

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Verifica se os dados têm uma coluna ID própria
   * @param {object} sampleData - Dados de exemplo
   * @returns {boolean} True se tem coluna ID própria
   */
  hasIdColumn(sampleData) {
    if (!sampleData || typeof sampleData !== 'object') {
      return false;
    }

    // Verifica por colunas que podem ser IDs
    const idColumns = ['id', 'ID', 'codigo', 'Codigo', 'codigoEmpresa', 'CodigoEmpresa'];

    for (const column of idColumns) {
      if (column in sampleData) {
        console.log(`Encontrada coluna ID própria: '${column}'`);
        return true;
      }
    }

    return false;
  }

  /**
   * Garante que a tabela existe com as colunas necessárias
   * @param {string} tableName - Nome da tabela
   * @param {object} sampleData - Dados de exemplo para inferir colunas
   * @param {boolean} hasIdColumn - Se os dados têm coluna ID própria
   */
  async ensureTable(tableName, sampleData, hasIdColumn = false) {
    try {
      // Verifica se a tabela já existe e suas colunas
      const existingColumns = await this.getTableColumns(tableName);

      if (existingColumns.length > 0) {
        // Tabela existe - assume que está configurada corretamente
        console.log(`Tabela ${tableName} já existe (${existingColumns.length} colunas)`);
        return;
      }

      // Tabela não existe, cria nova
      const columns = this.inferColumnsFromData(sampleData);
      await this.activeDriver.createTable(tableName, columns, hasIdColumn);
      console.log(`Tabela ${tableName} criada com ${Object.keys(columns).length} colunas (hasIdColumn: ${hasIdColumn})`);

    } catch (error) {
      console.error(`Erro ao garantir tabela ${tableName}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém colunas existentes de uma tabela
   * @param {string} tableName - Nome da tabela
   * @returns {array} Lista de colunas [{name, type}, ...]
   */
  async getTableColumns(tableName) {
    try {
      // Query específica do SQL Server para obter informações da tabela
      const sql = `
        SELECT COLUMN_NAME as name, DATA_TYPE as type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${tableName.replace('dbo.', '')}'
        ORDER BY ORDINAL_POSITION
      `;
      const columns = await this.activeDriver.query(sql);

      return columns.map(col => ({
        name: col.name,
        type: col.type
      }));
    } catch (error) {
      // Se erro (tabela não existe), retorna array vazio
      return [];
    }
  }

  /**
   * Adiciona uma coluna à tabela existente
   * @param {string} tableName - Nome da tabela
   * @param {string} columnName - Nome da coluna
   * @param {string} columnType - Tipo da coluna
   */
  async addColumnToTable(tableName, columnName, columnType) {
    const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`;
    await this.activeDriver.query(sql);
    console.log(`Coluna ${columnName} adicionada à tabela ${tableName}`);
  }

  /**
   * Infere colunas baseado nos dados (substitui a lógica antiga)
   * @param {object} sampleData - Dados de exemplo
   * @returns {object} Mapeamento coluna -> tipo
   */
  inferColumnsFromData(sampleData) {
    // Debug: Verificar sampleData real
    console.log('DEBUG INFER - sampleData keys:', Object.keys(sampleData));
    console.log('DEBUG INFER - has created_at:', sampleData.hasOwnProperty('created_at'));
    console.log('DEBUG INFER - created_at value:', sampleData.created_at);
    
    const columns = {};

    for (const [key, value] of Object.entries(sampleData)) {
      // Pula campos que conflitam com colunas automáticas do sistema
      if (key === 'created_at' || key === 'updated_at') {
        continue;
      }
      columns[key] = this.inferColumnType(value);
    }

    // Adiciona colunas padrão apenas se não existirem nos dados
    if (!sampleData.hasOwnProperty('created_at')) {
      columns.created_at = 'DATETIME';
    }

    // Debug: Mostrar columns final
    console.log('DEBUG INFER - final columns:', JSON.stringify(columns, null, 2));

    return columns;
  }

  /**
   * Infere tipo de coluna baseado no valor
   * @param {any} value - Valor
   * @returns {string} Tipo SQL
   */
  inferColumnType(value) {
    if (value === null || value === undefined) return 'TEXT';

    switch (typeof value) {
      case 'number':
        if (Number.isInteger(value)) {
          // Verifica se excede capacidade do INT (SQL Server: -2,147,483,648 a 2,147,483,647)
          if (value > 2147483647 || value < -2147483648) {
            return 'BIGINT';
          }
          return 'INTEGER';
        }
        return 'REAL';
      case 'boolean':
        return 'INTEGER'; // SQLite usa 0/1 para boolean
      case 'string':
        // Se parece data, usa DATETIME
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return 'DATETIME';
        }
        return 'TEXT';
      case 'object':
        return 'NVARCHAR(MAX)'; // JSON string para SQL Server
      default:
        return 'TEXT';
    }
  }

  /**
   * Executa query genérica
   * @param {string} sql - Query SQL
   * @param {array} params - Parâmetros
   * @returns {array} Resultados
   */
  async query(sql, params = []) {
    if (!this.connected || !this.activeDriver) {
      throw new Error('Transporte não conectado');
    }

    return await this.activeDriver.query(sql, params);
  }
}

// Instância singleton
const transportService = new TransportService();

export default transportService;
export { TransportService };
