import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Serviço de Geração de Configuração a partir de Swagger/OpenAPI
 * Converte arquivos swagger.json em configurações gicli
 */
class SwaggerGeneratorService {
  constructor() {
    this.supportedVersions = ['2.0', '3.0.1'];
  }

  /**
   * Gera session_name baseado no título da API
   * @param {string} title - Título da API do swagger
   * @returns {string} Nome da sessão formatado
   */
  generateSessionName(title) {
    if (!title || typeof title !== 'string') {
      return 'SESSION_API_TOKEN';
    }

    const cleaned = title
      // Remove sufixos comuns para manter consistência
      .replace(/\s+(API|Service|Integration|REST|SOAP)$/i, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase();

    // Fallback para títulos muito curtos ou inválidos
    if (cleaned.length < 3) {
      return 'SESSION_API_TOKEN';
    }

    return `SESSION_${cleaned}_TOKEN`;
  }

  /**
   * Valida se o arquivo swagger é suportado
   * @param {object} swagger - Objeto swagger parseado
   * @returns {boolean} True se for suportado
   */
  validateSwagger(swagger) {
    if (!swagger || typeof swagger !== 'object') {
      return false;
    }

    // Suporte para Swagger 2.0 e OpenAPI 3.0+
    const version = swagger.swagger || swagger.openapi;
    if (!version) {
      return false;
    }

    return this.supportedVersions.some(v => version.startsWith(v.split('.')[0]));
  }

  /**
   * Extrai a base_url do swagger
   * @param {object} swagger - Objeto swagger
   * @returns {string} Base URL
   */
  extractBaseUrl(swagger) {
    // OpenAPI 3.0 - usa servers
    if (swagger.servers && swagger.servers.length > 0) {
      return swagger.servers[0].url;
    }

    // Swagger 2.0 - usa host, basePath, schemes
    if (swagger.host) {
      const scheme = swagger.schemes && swagger.schemes[0] ? swagger.schemes[0] : 'https';
      const basePath = swagger.basePath || '';
      return `${scheme}://${swagger.host}${basePath}`;
    }

    return 'https://api.example.com';
  }

  /**
   * Gera jobs a partir dos paths do swagger
   * @param {object} swagger - Objeto swagger
   * @param {string} sessionName - Nome da sessão
   * @returns {Array} Lista de jobs gerados
   */
  generateJobs(swagger, sessionName) {
    const jobs = [];
    const paths = swagger.paths || {};

    // Gerar job de autenticação padrão
    jobs.push(this.generateAuthJob(sessionName));

    // Gerar jobs para cada endpoint
    Object.entries(paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, operation]) => {
        if (typeof operation === 'object' && method.toLowerCase() !== 'parameters') {
          const job = this.generateRequestJob(path, method, operation, sessionName);
          jobs.push(job);
        }
      });
    });

    return jobs;
  }

  /**
   * Gera job de autenticação padrão
   * @param {string} sessionName - Nome da sessão
   * @returns {object} Job de autenticação
   */
  generateAuthJob(sessionName) {
    return {
      id: 'login',
      type: 'auth',
      mode: 'production',
      session_name: sessionName,
      token_identifier: 'accessToken',
      token_expiration_identifier: 'expires_in',
      token_expiration_time: 3600,
      name: 'login',
      method: 'POST',
      path: '/login',
      params: {},
      headers: {
        'Content-Type': 'application/json'
      },
      auth: {},
      timeout: 5000,
      retry_policy: {},
      tags: ['auth'],
      response_format: 'json',
      payload: {}
    };
  }

  /**
   * Gera job de request a partir de uma operação swagger
   * @param {string} path - Path do endpoint
   * @param {string} method - Método HTTP
   * @param {object} operation - Objeto de operação swagger
   * @param {string} sessionName - Nome da sessão
   * @returns {object} Job gerado
   */
  generateRequestJob(path, method, operation, sessionName) {
    const jobId = this.generateJobId(operation.operationId, path, method);
    const jobName = operation.summary || operation.description || this.generateJobNameFromPath(path, method);

    // Extrair parâmetros
    const params = {};
    const headers = {
      'Authorization': `Bearer $${sessionName}`
    };

    if (operation.parameters) {
      operation.parameters.forEach(param => {
        if (param.in === 'query' && param.name) {
          params[param.name] = param.required ? '${' + param.name + '}' : '';
        } else if (param.in === 'header' && param.name && param.name !== 'Authorization') {
          headers[param.name] = param.required ? '${' + param.name + '}' : '';
        }
      });
    }

    // Gerar nome da tabela baseado no job ID
    const tableName = this.generateTableName(jobId);

    return {
      id: jobId,
      type: 'request',
      mode: 'production',
      session_name: sessionName,
      name: jobName,
      method: method.toUpperCase(),
      path: path,
      params: params,
      headers: headers,
      auth: {},
      timeout: 10000,
      retry_policy: {},
      tags: operation.tags || [],
      response_format: 'json',
      output: {
        enabled: true,
        type: 'database',
        driver: 'sqlserver',
        table: tableName,
        data_path: 'data',
        columns: {}
      },
      payload: {}
    };
  }

  /**
   * Gera nome do job baseado no path quando summary não está disponível
   * @param {string} path - Path do endpoint
   * @param {string} method - Método HTTP
   * @returns {string} Nome do job
   */
  generateJobNameFromPath(path, method) {
    // Extrair partes relevantes do path
    const pathParts = path.split('/').filter(part => part && !part.startsWith('{'));
    const resource = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'endpoint';
    return `${method.toUpperCase()} ${resource}`;
  }

  /**
   * Gera ID único para o job
   * @param {string} operationId - ID da operação swagger
   * @param {string} path - Path do endpoint
   * @param {string} method - Método HTTP
   * @returns {string} ID do job
   */
  generateJobId(operationId, path, method) {
    if (operationId) {
      // Limpar operationId para ser um ID válido
      return operationId
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .toLowerCase();
    }

    // Fallback baseado em path e method
    const pathPart = path.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    return `${method.toLowerCase()}_${pathPart}`;
  }

  /**
   * Gera nome da tabela baseado no job ID
   * @param {string} jobId - ID do job
   * @returns {string} Nome da tabela
   */
  generateTableName(jobId) {
    // Converter para PascalCase e adicionar prefixo se necessário
    const tableName = jobId
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('');

    return `API${tableName}`;
  }

  /**
   * Gera configuração completa a partir do swagger
   * @param {object} swagger - Objeto swagger parseado
   * @param {string} sessionName - Nome da sessão
   * @returns {object} Configuração gicli
   */
  generateConfig(swagger, sessionName) {
    const baseUrl = this.extractBaseUrl(swagger);
    const jobs = this.generateJobs(swagger, sessionName);

    return {
      group: swagger.info?.title || 'API',
      origins: [
        {
          name: swagger.info?.title?.toLowerCase().replace(/[^a-zA-Z0-9]/g, '_') || 'api',
          base_url: baseUrl,
          connection_string: 'ENC:CRYPTED_CONNECTION_STRING_HERE',
          job: jobs
        }
      ]
    };
  }

  /**
   * Processa arquivo swagger e gera configuração
   * @param {string} swaggerFile - Caminho do arquivo swagger
   * @param {string} outputFile - Caminho do arquivo de saída
   * @returns {Promise<boolean>} True se sucesso
   */
  async generateConfigFromFile(swaggerFile, outputFile) {
    try {
      // Validar arquivo de entrada
      if (!existsSync(swaggerFile)) {
        throw new Error(`Arquivo swagger não encontrado: ${swaggerFile}`);
      }

      // Ler e parsear swagger
      const swaggerContent = readFileSync(swaggerFile, 'utf-8');
      const swagger = JSON.parse(swaggerContent);

      // Validar formato swagger
      if (!this.validateSwagger(swagger)) {
        throw new Error('Formato swagger não suportado. Use Swagger 2.0 ou OpenAPI 3.0+');
      }

      // Gerar session name
      const sessionName = this.generateSessionName(swagger.info?.title);

      // Gerar configuração
      const config = this.generateConfig(swagger, sessionName);

      // Garantir diretório de saída
      const outputDir = dirname(outputFile);
      if (!existsSync(outputDir)) {
        require('fs').mkdirSync(outputDir, { recursive: true });
      }

      // Escrever arquivo de configuração
      writeFileSync(outputFile, JSON.stringify(config, null, 2));

      console.log(`✅ Configuração gerada: ${outputFile}`);
      console.log(`✅ Session name: ${sessionName}`);
      console.log(`✅ Jobs gerados: ${config.origins[0].job.length}`);

      // Adicionar instruções de pós-processamento
      console.log('\n📝 Próximos passos:');
      console.log('1. Edite o arquivo gerado para ajustar parâmetros');
      console.log('2. Configure a connection_string criptografada');
      console.log('3. Ajuste os parâmetros dos jobs conforme necessário');
      console.log('4. Teste com: gicli -p -j <job_id> -f ' + outputFile);

      return true;

    } catch (error) {
      console.error('❌ Erro ao gerar configuração:', error.message);
      throw error;
    }
  }
}

export default new SwaggerGeneratorService();
