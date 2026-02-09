/**
 * Serviço de Cliente HTTP
 * Abstração para requisições HTTP com suporte a retry e timeout
 */

class HttpClientService {
  constructor() {
    this.defaultTimeout = 30000; // 30 segundos
    this.defaultRetries = 3;
    this.defaultRetryDelay = 1000; // 1 segundo
  }

  /**
   * Faz uma requisição HTTP genérica
   * @param {string} method - Método HTTP
   * @param {string} url - URL da requisição
   * @param {object} options - Opções da requisição
   * @returns {Promise<object>} Resposta da requisição
   */
  async request(method, url, options = {}) {
    const {
      headers = {},
      body = null,
      timeout = this.defaultTimeout,
      retries = this.defaultRetries,
      retryDelay = this.defaultRetryDelay,
      ...fetchOptions
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchConfig = {
          method: method.toUpperCase(),
          headers,
          signal: controller.signal,
          ...fetchOptions
        };

        if (body && (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD')) {
          if (typeof body === 'object') {
            fetchConfig.body = JSON.stringify(body);
            fetchConfig.headers['Content-Type'] = 'application/json';
          } else {
            fetchConfig.body = body;
          }
        }

        console.log(`[HTTP-CLIENT] Fazendo ${method.toUpperCase()} para: ${url}`);
        
        // Mascarar token de autorização nos headers para log
        let logHeaders = { ...headers };
        if (logHeaders['Authorization'] && logHeaders['Authorization'].startsWith('Bearer ')) {
          logHeaders['Authorization'] = 'Bearer ***';
        }
        
        console.log(`[HTTP-CLIENT] Headers:`, JSON.stringify(logHeaders, null, 2));
        console.log(`[HTTP-CLIENT] Timeout: ${timeout}ms, Tentativa: ${attempt}/${retries + 1}`);

        const response = await fetch(url, fetchConfig);
        clearTimeout(timeoutId);

        const responseData = await this.parseResponse(response);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data: responseData,
          url: response.url
        };

      } catch (error) {
        lastError = error;

        console.log(`[HTTP-CLIENT] Erro na tentativa ${attempt}:`, error.message);
        console.log(`[HTTP-CLIENT] Tipo do erro:`, error.constructor.name);

        // Não tenta retry para erros de cliente (4xx) ou se é a última tentativa
        if (attempt > retries ||
            (error.message.includes('HTTP 4') && !error.message.includes('408'))) {
          break;
        }

        console.warn(`Tentativa ${attempt} falhou, tentando novamente em ${retryDelay}ms:`, error.message);

        if (attempt <= retries) {
          await this.delay(retryDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Faz requisição GET
   * @param {string} url - URL
   * @param {object} options - Opções
   * @returns {Promise<object>} Resposta
   */
  async get(url, options = {}) {
    return this.request('GET', url, options);
  }

  /**
   * Faz requisição POST
   * @param {string} url - URL
   * @param {any} data - Dados do body
   * @param {object} options - Opções
   * @returns {Promise<object>} Resposta
   */
  async post(url, data = null, options = {}) {
    return this.request('POST', url, { ...options, body: data });
  }

  /**
   * Faz requisição PUT
   * @param {string} url - URL
   * @param {any} data - Dados do body
   * @param {object} options - Opções
   * @returns {Promise<object>} Resposta
   */
  async put(url, data = null, options = {}) {
    return this.request('PUT', url, { ...options, body: data });
  }

  /**
   * Faz requisição DELETE
   * @param {string} url - URL
   * @param {object} options - Opções
   * @returns {Promise<object>} Resposta
   */
  async delete(url, options = {}) {
    return this.request('DELETE', url, options);
  }

  /**
   * Faz parse da resposta baseado no Content-Type
   * @param {Response} response - Resposta do fetch
   * @returns {Promise<any>} Dados parseados
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type');

    if (contentType?.includes('application/json')) {
      return response.json();
    }

    if (contentType?.includes('text/')) {
      return response.text();
    }

    // Para outros tipos, retorna como buffer
    return response.arrayBuffer();
  }

  /**
   * Delay helper
   * @param {number} ms - Milissegundos
   * @returns {Promise<void>}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Configura valores padrão
   * @param {object} config - Configuração
   */
  setDefaults(config) {
    if (config.timeout) this.defaultTimeout = config.timeout;
    if (config.retries !== undefined) this.defaultRetries = config.retries;
    if (config.retryDelay) this.defaultRetryDelay = config.retryDelay;
  }
}

// Instância singleton do serviço
const httpClientService = new HttpClientService();

export default httpClientService;
export { HttpClientService };
