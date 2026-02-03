import { Database } from 'bun:sqlite';
import { join } from 'path';

/**
 * Driver para SQLite usando bun:sqlite
 * Gerencia conexões e operações básicas no SQLite
 */
class SQLiteDriver {
  constructor() {
    this.db = null;
  }

  /**
   * Conecta ao banco de dados SQLite
   * @param {string} connectionString - Caminho para o arquivo .db
   */
  connect(connectionString) {
    try {
      // Se for caminho relativo, resolve para a pasta do projeto
      const dbPath = connectionString.startsWith('/')
        ? connectionString
        : join(process.cwd(), connectionString);

      this.db = new Database(dbPath);
      console.log(`Conectado ao SQLite: ${dbPath}`);
      return true;
    } catch (error) {
      console.error('Erro ao conectar ao SQLite:', error.message);
      throw error;
    }
  }

  /**
   * Desconecta do banco de dados
   */
  disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('Desconectado do SQLite');
    }
  }

  /**
   * Cria tabela se não existir
   * @param {string} tableName - Nome da tabela
   * @param {object} columns - Definição das colunas {coluna: tipo}
   */
  createTable(tableName, columns) {
    if (!this.db) throw new Error('Banco não conectado');

    const columnDefs = Object.entries(columns)
      .map(([col, type]) => `${col} ${type}`)
      .join(', ');

    // Só adiciona id auto-increment se não houver uma coluna 'id' definida nos dados
    const hasIdColumn = Object.keys(columns).some(col => col.toLowerCase() === 'id');
    const idColumn = hasIdColumn ? '' : 'id INTEGER PRIMARY KEY AUTOINCREMENT, ';

    const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (${idColumn}${columnDefs})`;

    try {
      this.db.run(sql);
      console.log(`Tabela ${tableName} criada/verificada${hasIdColumn ? ' (com id personalizado)' : ' (com id auto-increment)'}`);
    } catch (error) {
      console.error(`Erro ao criar tabela ${tableName}:`, error.message);
      throw error;
    }
  }

  /**
   * Insere dados na tabela
   * @param {string} tableName - Nome da tabela
   * @param {object} data - Dados a inserir
   * @returns {number} ID do registro inserido
   */
  insert(tableName, data) {
    if (!this.db) throw new Error('Banco não conectado');

    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(data);

    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

    try {
      const stmt = this.db.prepare(sql);
      const result = stmt.run(values);
      console.log(`Dados inseridos na tabela ${tableName}, ID: ${result.lastInsertRow}`);
      return result.lastInsertRow;
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
  query(sql, params = []) {
    if (!this.db) throw new Error('Banco não conectado');

    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(params);
    } catch (error) {
      console.error('Erro ao executar query:', error.message);
      throw error;
    }
  }
}

export { SQLiteDriver };
