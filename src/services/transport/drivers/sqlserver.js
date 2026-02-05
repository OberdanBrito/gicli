import sql from 'mssql';

/**
 * Driver para SQL Server
 * Gerencia conexões e operações básicas no SQL Server
 */
class SQLServerDriver {
  constructor() {
    this.pool = null;
  }

  /**
   * Conecta ao banco de dados SQL Server
   * @param {string} connectionString - String de conexão
   */
  async connect(connectionString) {
    try {
      const config = this.parseConnectionString(connectionString);

      this.pool = await sql.connect(config);
      console.log(`Conectado ao SQL Server: ${config.server}/${config.database}`);
      return true;
    } catch (error) {
      console.error('Erro ao conectar ao SQL Server:', error.message);
      throw error;
    }
  }

  /**
   * Desconecta do banco de dados
   */
  async disconnect() {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      console.log('Desconectado do SQL Server');
    }
  }

  /**
   * Parse da connection string para config do mssql
   * @param {string} connStr - String de conexão
   * @returns {object} Configuração para mssql
   */
  parseConnectionString(connStr) {
    const config = {};
    const pairs = connStr.split(';');

    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (key && value) {
        const cleanKey = key.trim().toLowerCase();
        const cleanValue = value.trim();

        switch (cleanKey) {
          case 'server':
            // Trata formato host,porta
            const serverParts = cleanValue.split(',');
            config.server = serverParts[0].trim();
            if (serverParts.length > 1) {
              config.port = parseInt(serverParts[1].trim());
            }
            break;
          case 'database':
            config.database = cleanValue;
            break;
          case 'user':
          case 'userid':
            config.user = cleanValue;
            break;
          case 'password':
          case 'pwd':
            config.password = cleanValue;
            break;
          case 'port':
            config.port = parseInt(cleanValue);
            break;
          case 'encrypt':
            config.options = config.options || {};
            config.options.encrypt = cleanValue.toLowerCase() === 'true';
            break;
          case 'trustservercertificate':
            config.options = config.options || {};
            config.options.trustServerCertificate = cleanValue.toLowerCase() === 'true';
            break;
          case 'application name':
          case 'applicationname':
            config.options = config.options || {};
            config.options.appName = cleanValue;
            break;
        }
      }
    }

    // Defaults
    config.options = config.options || {};
    config.options.enableArithAbort = true;
    
    // Configurações de timeout para operações mais lentas
    config.requestTimeout = 50000; // 50 segundos para queries
    config.connectionTimeout = 30000; // 30 segundos para conexão
    config.cancelTimeout = 5000; // 5 segundos para cancelamento
    
    // Se TrustServerCertificate=true, desabilita encrypt para evitar problemas com IP
    if (config.options.trustServerCertificate && config.options.encrypt !== false) {
      config.options.encrypt = false;
    }

    return config;
  }

  /**
   * Limpa tabela antes de inserir novos dados
   * @param {string} tableName - Nome da tabela
   */
  async clearTable(tableName) {
    if (!this.pool) throw new Error('Banco não conectado');

    try {
      // Tenta TRUNCATE primeiro (mais rápido, mas falha com FK)
      const truncateSql = `TRUNCATE TABLE [${tableName}]`;
      await this.pool.request().query(truncateSql);
      console.log(`Tabela ${tableName} limpa com TRUNCATE`);
    } catch (truncateError) {
      // Se TRUNCATE falhar (provavelmente por foreign keys), usa DELETE
      try {
        console.log(`TRUNCATE falhou para ${tableName}, usando DELETE...`);
        const deleteSql = `DELETE FROM [${tableName}]`;
        await this.pool.request().query(deleteSql);
        console.log(`Tabela ${tableName} limpa com DELETE`);
      } catch (deleteError) {
        console.error(`Erro ao limpar tabela ${tableName}:`, deleteError.message);
        throw deleteError;
      }
    }
  }

  /**
   * Cria tabela se não existir
   * @param {string} tableName - Nome da tabela
   * @param {object} columns - Definição das colunas {coluna: tipo}
   * @param {boolean} hasIdColumn - Se os dados já têm coluna ID
   */
  async createTable(tableName, columns, hasIdColumn = false) {
    if (!this.pool) throw new Error('Banco não conectado');

    // Debug: Mostrar colunas recebidas
    console.log(`DEBUG CREATE TABLE - ${tableName}:`, Object.keys(columns));
    console.log(`DEBUG CREATE TABLE - columns object:`, columns);

    const columnDefs = Object.entries(columns)
      .map(([col, type]) => `[${col}] ${type}`)
      .join(', ');

    // Se os dados já têm coluna ID, usa ela como chave primária
    // Caso contrário, cria uma coluna IDENTITY
    const idColumn = hasIdColumn
      ? ''
      : '[id] INT IDENTITY(1,1) PRIMARY KEY,';

    const sql = `IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='${tableName}' AND xtype='U')
                 CREATE TABLE [${tableName}] (
                   ${idColumn}
                   ${columnDefs}
                 )`;

    // Debug: Mostrar SQL final gerado
    console.log('DEBUG CREATE TABLE - SQL gerado:');
    console.log(sql);

    try {
      await this.pool.request().query(sql);
      console.log(`Tabela ${tableName} criada/verificada (hasIdColumn: ${hasIdColumn})`);
    } catch (error) {
      console.error(`Erro ao criar tabela ${tableName}:`, error.message);
      throw error;
    }
  }

  /**
   * Insere dados na tabela
   * @param {string} tableName - Nome da tabela
   * @param {object} data - Dados a inserir
   * @param {boolean} hasIdColumn - Se os dados têm coluna ID própria
   * @returns {number} ID do registro inserido
   */
  async insert(tableName, data, hasIdColumn = false) {
    if (!this.pool) throw new Error('Banco não conectado');

    const columns = Object.keys(data);
    const values = Object.values(data);

    // Remove coluna 'id' dos inserts se ela for IDENTITY (só para dados que não têm ID própria)
    let actualColumns = columns;
    let actualValues = values;
    let returnId = 'INSERTED.id';

    if (!hasIdColumn && columns.includes('id')) {
      // Se não há coluna ID própria mas os dados têm 'id', não incluímos no insert
      const idIndex = columns.indexOf('id');
      actualColumns = columns.filter(col => col !== 'id');
      actualValues = values.filter((_, index) => index !== idIndex);
    } else if (hasIdColumn) {
      // Se há coluna ID própria, usamos ela como retorno
      returnId = 'INSERTED.id';
    }

    const columnList = actualColumns.map(col => `[${col}]`).join(', ');
    const paramList = actualColumns.map((col, index) => `@p${index + 1}`).join(', ');

    const sql = `INSERT INTO [${tableName}] (${columnList}) OUTPUT ${returnId} VALUES (${paramList})`;

    try {
      const request = this.pool.request();

      // Bind parameters
      actualValues.forEach((value, index) => {
        request.input(`p${index + 1}`, value);
      });

      const result = await request.query(sql);
      const id = result.recordset[0].id;

      console.log(`Dados inseridos na tabela ${tableName}, ID: ${id}`);
      return id;
    } catch (error) {
      console.error(`Erro ao inserir dados na tabela ${tableName}:`, error.message);
      throw error;
    }
  }

  /**
   * Executa query SELECT
   * @param {string} sql - Query SQL
   * @param {array} params - Parâmetros da query
   * @returns {array} Resultados
   */
  async query(sqlQuery, params = []) {
    if (!this.pool) throw new Error('Banco não conectado');

    try {
      const request = this.pool.request();

      // Bind parameters if any
      params.forEach((param, index) => {
        request.input(`p${index + 1}`, param);
      });

      const result = await request.query(sqlQuery);
      return result.recordset;
    } catch (error) {
      console.error('Erro ao executar query:', error.message);
      throw error;
    }
  }
}

export { SQLServerDriver };
