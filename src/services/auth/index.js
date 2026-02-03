import httpClientService from '../http-client/index.js';
import sessionService from '../session/index.js';
import environmentService from '../environment/index.js';

/**
 * Serviço de Autenticação
 * Gerencia login e tokens de sessão
 */

class AuthService {
  constructor() {
    this.activeSessions = new Map(); // origin -> sessionName
  }

  /**
   * Executa autenticação para um job de auth
   * @param {object} originConfig - Configuração da origem
   * @param {object} jobConfig - Configuração do job de auth
   * @param {string} mode - Modo de execução
   * @returns {Promise<boolean>} True se autenticado com sucesso
   */
  async authenticate(originConfig, jobConfig, mode = 'production') {
    try {
      console.log(`Iniciando autenticação para ${originConfig.name}`);

      // Carrega variáveis de ambiente
      environmentService.load(originConfig.name);

      // Constrói a URL completa
      const url = this.buildUrl(originConfig.base_url, jobConfig.path, jobConfig.params);

      // Prepara headers
      const headers = { ...jobConfig.headers };

      // Substitui variáveis de ambiente
      const processedPayload = environmentService.substituteDeep(jobConfig.payload, originConfig.name);
      const processedHeaders = environmentService.substituteDeep(headers, originConfig.name);

      // Faz a requisição
      const response = await httpClientService.request(jobConfig.method, url, {
        headers: processedHeaders,
        body: processedPayload,
        timeout: jobConfig.timeout || 30000
      });

      // Extrai o token da resposta
      const token = this.extractToken(response.data, jobConfig);

      if (!token) {
        throw new Error('Token não encontrado na resposta de autenticação');
      }

      // Determina o tempo de expiração
      const expiresIn = this.extractExpiration(response.data, jobConfig);
      const sessionName = jobConfig.session_name || `SESSION_${originConfig.name.toUpperCase()}_TOKEN`;

      // Armazena na sessão
      sessionService.set(sessionName, token, expiresIn);

      // Registra a sessão ativa
      this.activeSessions.set(originConfig.name, sessionName);

      console.log(`Autenticação bem-sucedida para ${originConfig.name}, token armazenado em ${sessionName}`);

      return true;

    } catch (error) {
      console.error(`Erro na autenticação para ${originConfig.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Verifica se há um token válido para uma origem
   * @param {string} originName - Nome da origem
   * @returns {boolean} True se há token válido
   */
  isAuthenticated(originName) {
    const sessionName = this.activeSessions.get(originName);
    return sessionName ? sessionService.has(sessionName) : false;
  }

  /**
   * Obtém token para uma origem
   * @param {string} originName - Nome da origem
   * @returns {string|null} Token ou null se não encontrado
   */
  getToken(originName) {
    const sessionName = this.activeSessions.get(originName);
    return sessionName ? sessionService.get(sessionName) : null;
  }

  /**
   * Renova autenticação se necessário
   * @param {object} originConfig - Configuração da origem
   * @param {object} jobConfig - Configuração do job de auth
   * @param {string} mode - Modo de execução
   * @returns {Promise<boolean>} True se renovado
   */
  async refreshAuthentication(originConfig, jobConfig, mode = 'production') {
    if (this.isAuthenticated(originConfig.name)) {
      console.log(`Token ainda válido para ${originConfig.name}`);
      return true;
    }

    return this.authenticate(originConfig, jobConfig, mode);
  }

  /**
   * Remove autenticação para uma origem
   * @param {string} originName - Nome da origem
   */
  logout(originName) {
    const sessionName = this.activeSessions.get(originName);
    if (sessionName) {
      sessionService.delete(sessionName);
      this.activeSessions.delete(originName);
      console.log(`Logout realizado para ${originName}`);
    }
  }

  /**
   * Constrói URL completa com parâmetros de query
   * @param {string} baseUrl - URL base
   * @param {string} path - Caminho do endpoint
   * @param {object} params - Parâmetros de query
   * @returns {string} URL completa
   */
  buildUrl(baseUrl, path, params = {}) {
    let url = baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

    const queryParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        queryParams.append(key, value);
      }
    }

    const queryString = queryParams.toString();
    if (queryString) {
      url += '?' + queryString;
    }

    return url;
  }

  /**
   * Extrai token da resposta
   * @param {any} responseData - Dados da resposta
   * @param {object} jobConfig - Configuração do job
   * @returns {string|null} Token extraído
   */
  extractToken(responseData, jobConfig) {
    const tokenPath = jobConfig.token_identifier;

    if (!tokenPath) return null;

    // Se for caminho simples (ex: "token")
    if (typeof responseData === 'object' && responseData[tokenPath]) {
      return responseData[tokenPath];
    }

    // Se for caminho aninhado (ex: "data.token")
    const pathParts = tokenPath.split('.');
    let current = responseData;

    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return null;
      }
    }

    return typeof current === 'string' ? current : null;
  }

  /**
   * Extrai tempo de expiração da resposta
   * @param {any} responseData - Dados da resposta
   * @param {object} jobConfig - Configuração do job
   * @returns {number|null} Segundos até expirar
   */
  extractExpiration(responseData, jobConfig) {
    const expirationPath = jobConfig.token_expiration_identifier;
    const defaultTime = jobConfig.token_expiration_time;

    if (!expirationPath) return defaultTime || 3600; // 1 hora padrão

    // Se for caminho simples
    if (typeof responseData === 'object' && responseData[expirationPath]) {
      const value = responseData[expirationPath];
      return typeof value === 'number' ? value : parseInt(value);
    }

    // Se for caminho aninhado
    const pathParts = expirationPath.split('.');
    let current = responseData;

    for (const part of pathParts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        return defaultTime || 3600;
      }
    }

    return typeof current === 'number' ? current : parseInt(current) || defaultTime || 3600;
  }
}

// Instância singleton do serviço
const authService = new AuthService();

export default authService;
export { AuthService };
