import httpClientService from '../http-client/index.js';
import authService from '../auth/index.js';
import environmentService from '../environment/index.js';
import sessionService from '../session/index.js';
import fileOutputService from '../file-output/index.js';
import transportService from '../transport/index.js';
import loggerService from '../logger/index.js';

/**
 * Serviço de Execução
 * Orquestra execução de jobs com autenticação e processamento de resposta
 */

class ExecutionService {
  constructor() {
    this.runningJobs = new Set(); // Jobs em execução
  }

  /**
   * Executa um job completo
   * @param {object} originConfig - Configuração da origem
   * @param {object} jobConfig - Configuração do job
   * @param {string} mode - Modo de execução
   * @param {boolean} silent - Modo silencioso
   * @returns {Promise<object>} Resultado da execução
   */
  async executeJob(originConfig, jobConfig, mode = 'production', silent = false) {
    const jobId = `${originConfig.name}_${jobConfig.id}`;

    if (this.runningJobs.has(jobId)) {
      throw new Error(`Job ${jobId} já está em execução`);
    }

    this.runningJobs.add(jobId);

    try {
      if (!silent) {
        loggerService.info(`Iniciando execução do job: ${jobId}`);
      }

      // Carrega variáveis de ambiente
      environmentService.load(originConfig.name);

      // Se for job de auth, delega para auth service
      if (jobConfig.type === 'auth') {
        const result = await authService.authenticate(originConfig, jobConfig, mode);
        return {
          success: true,
          type: 'auth',
          jobId,
          authenticated: result
        };
      }

      // Para jobs de request, verifica autenticação se necessário
      if (jobConfig.type === 'request') {
        // Verifica se há auth necessário (presença de session_name)
        if (jobConfig.session_name) {
          await authService.refreshAuthentication(originConfig, this.findAuthJob(originConfig), mode);
        }

        // Executa a requisição
        const result = await this.executeRequest(originConfig, jobConfig, mode);

        return {
          success: true,
          type: 'request',
          jobId,
          response: result
        };
      }

      throw new Error(`Tipo de job não suportado: ${jobConfig.type}`);

    } catch (error) {
      if (!silent) {
        loggerService.error(`Erro na execução do job ${jobId}:`, error.message);
      }
      return {
        success: false,
        jobId,
        error: error.message
      };
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  /**
   * Executa uma requisição HTTP
   * @param {object} originConfig - Configuração da origem
   * @param {object} jobConfig - Configuração do job
   * @param {string} mode - Modo de execução
   * @returns {Promise<object>} Resultado da requisição
   */
  async executeRequest(originConfig, jobConfig, mode = 'production') {
    let authRetryAttempted = false;

    // Função auxiliar para fazer a requisição
    const makeRequest = async () => {
      // Constrói a URL
      const url = this.buildUrl(originConfig.base_url, jobConfig.path, jobConfig.params);

      // Prepara headers
      const headers = { ...jobConfig.headers };

      // Adiciona token de autenticação se disponível
      if (jobConfig.session_name) {
        const token = authService.getToken(originConfig.name);
        if (token) {
          // Determina o tipo de auth baseado na configuração
          const authType = jobConfig.auth?.type || 'Bearer';
          headers['Authorization'] = `${authType} ${token}`;
        }
      }

      // Substitui variáveis de ambiente e sessão
      const processedHeaders = this.substituteVariables(headers, originConfig.name);
      const processedPayload = this.substituteVariables(jobConfig.payload, originConfig.name);
      const processedParams = this.substituteVariables(jobConfig.params, originConfig.name);

      // Reconstrói URL com params processados
      const finalUrl = this.buildUrl(originConfig.base_url, jobConfig.path, processedParams);

      // Configurações de retry e timeout
      const retryPolicy = jobConfig.retry_policy || {};
      const httpOptions = {
        headers: processedHeaders,
        timeout: jobConfig.timeout || 30000,
        retries: retryPolicy.max_attempts || 3,
        retryDelay: retryPolicy.delay || 1000
      };

      // Adiciona body se houver
      if (processedPayload && jobConfig.method !== 'GET') {
        httpOptions.body = processedPayload;
      }

      // Faz a requisição
      const response = await httpClientService.request(jobConfig.method, finalUrl, httpOptions);

      return { response, finalUrl };
    };

    try {
      // Primeira tentativa de requisição
      let requestResult = await makeRequest();
      let response = requestResult.response;
      let finalUrl = requestResult.finalUrl;

      // Se recebeu 401 e ainda não tentou renovar auth, tenta novamente
      if (response.status === 401 && jobConfig.session_name && !authRetryAttempted) {
        loggerService.info(`Recebido 401 para job ${jobConfig.id}, tentando renovar autenticação...`);
        authRetryAttempted = true;

        try {
          // Renova autenticação
          await authService.refreshAuthentication(originConfig, this.findAuthJob(originConfig), mode);
          loggerService.info(`Autenticação renovada para ${originConfig.name}, tentando requisição novamente...`);

          // Refaz a requisição com novo token
          requestResult = await makeRequest();
          response = requestResult.response;
          finalUrl = requestResult.finalUrl;
          loggerService.info(`Requisição bem-sucedida após renovação de token`);
        } catch (authError) {
          loggerService.warn(`Falha ao renovar autenticação: ${authError.message}`);
          // Continua com a resposta original de erro
        }
      }

      // Processa a resposta baseado no formato esperado
      const processedResponse = this.processResponse(response, jobConfig.response_format);

      // Log da resposta para debug
      loggerService.info(`Resposta recebida - Status: ${response.status}, Tamanho: ${JSON.stringify(processedResponse).length} chars`);
      if (Array.isArray(processedResponse)) {
        loggerService.info(`Dados: Array com ${processedResponse.length} itens`);
        if (processedResponse.length > 0) {
          loggerService.info(`Primeiro item:`, JSON.stringify(processedResponse[0], null, 2));
        }
      } else if (typeof processedResponse === 'object' && processedResponse !== null) {
        loggerService.info(`Dados: Objeto com ${Object.keys(processedResponse).length} propriedades`);        
      } else {
        loggerService.info(`Dados: ${typeof processedResponse} - ${JSON.stringify(processedResponse)}`);
      }

      return {
        url: finalUrl,
        method: jobConfig.method,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: processedResponse,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      // Se é erro 401 e ainda não tentou renovar auth, tenta uma vez
      if (error.message.includes('HTTP 401') && jobConfig.session_name && !authRetryAttempted) {
        loggerService.info(`Erro 401 na primeira tentativa para job ${jobConfig.id}, tentando renovar autenticação...`);
        authRetryAttempted = true;

        try {
          // Renova autenticação
          await authService.refreshAuthentication(originConfig, this.findAuthJob(originConfig), mode);
          loggerService.info(`Autenticação renovada para ${originConfig.name}, tentando requisição novamente...`);

          // Refaz a requisição com novo token
          const retryResult = await makeRequest();
          const response = retryResult.response;
          const finalUrl = retryResult.finalUrl;
          const processedResponse = this.processResponse(response, jobConfig.response_format);

          loggerService.info(`Requisição bem-sucedida após renovação de token`);
          return {
            url: response.url || finalUrl,
            method: jobConfig.method,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            data: processedResponse,
            timestamp: new Date().toISOString()
          };

        } catch (retryError) {
          loggerService.warn(`Falha na tentativa de retry após renovação: ${retryError.message}`);
          throw error; // Lança o erro original
        }
      }

      // Para outros erros ou se já tentou renovar auth, lança o erro
      throw error;
    }
  }

  /**
   * Constrói URL completa
   * @param {string} baseUrl - URL base
   * @param {string} path - Caminho
   * @param {object} params - Parâmetros de query
   * @returns {string} URL completa
   */
  buildUrl(baseUrl, path, params = {}) {
    let url = baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

    const queryParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params || {})) {
      if (value !== null && value !== undefined) {
        queryParams.append(key, String(value));
      }
    }

    const queryString = queryParams.toString();
    if (queryString) {
      url += '?' + queryString;
    }

    return url;
  }

  /**
   * Substitui variáveis $ENV_* e $SESSION_*
   * @param {any} data - Dados a processar
   * @param {string} originName - Nome da origem
   * @returns {any} Dados processados
   */
  substituteVariables(data, originName) {
    if (typeof data === 'string') {
      // Substitui $ENV_*
      data = environmentService.substitute(data, originName);

      // Substitui $SESSION_*
      data = data.replace(/\$SESSION_([A-Z_][A-Z0-9_]*)/g, (match, sessionKey) => {
        const value = sessionService.get(sessionKey);
        return value || match;
      });

      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.substituteVariables(item, originName));
    }

    if (data && typeof data === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.substituteVariables(value, originName);
      }
      return result;
    }

    return data;
  }

  /**
   * Processa resposta baseado no formato esperado
   * @param {object} response - Resposta HTTP
   * @param {string} format - Formato esperado
   * @returns {any} Dados processados
   */
  processResponse(response, format = 'json') {
    switch (format) {
      case 'json':
        return typeof response.data === 'object' ? response.data : JSON.parse(response.data);
      case 'xml':
        // TODO: Implementar parser XML
        return response.data;
      case 'text':
      default:
        return response.data;
    }
  }

  /**
   * Encontra job de auth para uma origem
   * @param {object} originConfig - Configuração da origem
   * @returns {object|null} Job de auth ou null
   */
  findAuthJob(originConfig) {
    return originConfig.job?.find(job => job.type === 'auth') || null;
  }

  /**
   * Lista jobs em execução
   * @returns {string[]} Lista de jobIds
   */
  getRunningJobs() {
    return Array.from(this.runningJobs);
  }
}

// Instância singleton do serviço
const executionService = new ExecutionService();

export default executionService;
export { ExecutionService };
