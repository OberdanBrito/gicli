import loggerService from '../services/logger/index.js';

/**
 * Classe base para todos os serviços
 * Garante uso obrigatório de logging
 */
class BaseService {
  constructor() {
    this.logger = loggerService;
  }

  /**
   * Método utilitário para logging de início de operação
   * @param {string} operation - Nome da operação
   * @param {object} context - Contexto adicional
   */
  logStart(operation, context = {}) {
    this.logger.info(`Iniciando ${operation}`, context);
  }

  /**
   * Método utilitário para logging de fim de operação
   * @param {string} operation - Nome da operação
   * @param {boolean} success - Se a operação foi bem-sucedida
   * @param {object} context - Contexto adicional
   */
  logEnd(operation, success = true, context = {}) {
    const level = success ? 'info' : 'error';
    const message = `${operation} ${success ? 'concluída' : 'falhou'}`;
    this.logger[level](message, context);
  }

  /**
   * Método utilitário para logging de erros
   * @param {string} operation - Nome da operação
   * @param {Error} error - Erro ocorrido
   * @param {object} context - Contexto adicional
   */
  logError(operation, error, context = {}) {
    this.logger.error(`Erro em ${operation}: ${error.message}`, { ...context, error: error.stack });
  }
}

export default BaseService;
