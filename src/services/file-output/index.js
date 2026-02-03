import { writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import loggerService from '../logger/index.js';

/**
 * Serviço de Direcionamento de Dados para Arquivos
 * Gerencia salvamento de respostas de requisições em arquivos
 */

class FileOutputService {
  constructor() {
    this.placeholderRegex = /\$([A-Z_][A-Z0-9_]*)/g;
  }

  /**
   * Processa output de uma resposta HTTP
   * @param {object} response - Resposta HTTP (axios response object)
   * @param {object} jobConfig - Configuração do job
   * @param {object} metadata - Metadados adicionais
   * @returns {object} Resultado do processamento
   */
  async processOutput(response, jobConfig, metadata = {}) {
    try {
      // Verifica se output está habilitado
      if (!jobConfig.output || !jobConfig.output.enabled) {
        loggerService.debug(`Output desabilitado para job ${jobConfig.id}`);
        return { success: true, message: 'Output desabilitado' };
      }

      const outputConfig = jobConfig.output;

      // Determina formato do arquivo
      const format = this.determineFormat(response, outputConfig);

      // Resolve placeholders no nome do arquivo
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

      const filename = this.resolvePlaceholders(outputConfig.filename, {
        jobId: jobConfig.id,
        ts: timestamp,
        ...metadata
      });

      // Caminho completo do arquivo
      loggerService.debug(`Caminho base: ${process.cwd()}`);
      loggerService.debug(`Caminho relativo: ${outputConfig.path}`);
      loggerService.debug(`Nome do arquivo: ${filename}`);
      const filePath = join(process.cwd(), outputConfig.path, filename);
      loggerService.debug(`Caminho completo: ${filePath}`);

      // Cria diretório se não existir
      const dirPath = dirname(filePath);
      loggerService.debug(`Verificando diretório: ${dirPath}`);
      if (!existsSync(dirPath)) {
        loggerService.info(`Criando diretório: ${dirPath}`);
        mkdirSync(dirPath, { recursive: true });
        loggerService.info(`Diretório criado: ${dirPath}`);
      } else {
        loggerService.debug(`Diretório já existe: ${dirPath}`);
      }

      // Verifica se arquivo existe e se deve sobrescrever
      loggerService.debug(`Verificando arquivo: ${filePath}`);
      if (existsSync(filePath) && !outputConfig.overwrite) {
        const error = new Error(`Arquivo já existe e sobrescrição desabilitada: ${filePath}`);
        loggerService.error(`Falha ao salvar arquivo para job ${jobConfig.id}`, error);
        return { success: false, error: error.message };
      }

      // Prepara conteúdo baseado no formato
      const content = this.prepareContent(response.data, format);
      loggerService.debug(`Conteúdo preparado, tamanho: ${content.length}`);

      // Salva arquivo
      loggerService.info(`Salvando arquivo: ${filePath}`);

      // Verificação extra: garantir que o diretório existe imediatamente antes de salvar
      if (!existsSync(dirPath)) {
        loggerService.error(`Diretório não existe mais: ${dirPath}`);
        throw new Error(`Diretório não encontrado: ${dirPath}`);
      }

      writeFileSync(filePath, content, this.getEncoding(format));

      loggerService.info(`Arquivo salvo com sucesso: ${filePath}`, {
        jobId: jobConfig.id,
        format,
        size: Buffer.byteLength(content, this.getEncoding(format))
      });

      return {
        success: true,
        filePath,
        format,
        size: Buffer.byteLength(content, this.getEncoding(format))
      };

    } catch (error) {
      loggerService.error(`Erro ao processar output para job ${jobConfig.id}`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Determina formato do arquivo baseado na resposta e configuração
   * @param {object} response - Resposta HTTP
   * @param {object} outputConfig - Configuração de output
   * @returns {string} Formato determinado
   */
  determineFormat(response, outputConfig) {
    // Se especificado manualmente, usa o configurado
    if (outputConfig.format && outputConfig.format !== 'auto') {
      return outputConfig.format;
    }

    // Detecta baseado no Content-Type
    const contentType = response.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      return 'json';
    } else if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
      return 'xml';
    } else if (contentType.includes('text/')) {
      return 'txt';
    } else {
      return 'txt'; // fallback
    }
  }

  /**
   * Resolve placeholders no nome do arquivo
   * @param {string} template - Template com placeholders
   * @param {object} context - Contexto para substituição
   * @returns {string} Nome resolvido
   */
  resolvePlaceholders(template, context) {
    return template.replace(this.placeholderRegex, (match, placeholder) => {
      const key = placeholder.toLowerCase();
      const value = context[key];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Prepara conteúdo baseado no formato
   * @param {any} data - Dados da resposta
   * @param {string} format - Formato desejado
   * @returns {string} Conteúdo formatado
   */
  prepareContent(data, format) {
    switch (format) {
      case 'json':
        return typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      case 'xml':
        // Se já é string, assume que já está formatado
        if (typeof data === 'string') {
          return data;
        }
        // Para objetos, tenta converter (implementação básica)
        return JSON.stringify(data, null, 2); // fallback

      case 'txt':
      default:
        return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    }
  }

  /**
   * Retorna encoding apropriado para o formato
   * @param {string} format - Formato do arquivo
   * @returns {string} Encoding
   */
  getEncoding(format) {
    switch (format) {
      case 'json':
      case 'xml':
      case 'txt':
      default:
        return 'utf8';
    }
  }

  /**
   * Lista arquivos em um diretório de output
   * @param {string} outputPath - Caminho do diretório
   * @returns {string[]} Lista de arquivos
   */
  listOutputFiles(outputPath) {
    try {
      const fullPath = join(process.cwd(), outputPath);

      if (!existsSync(fullPath)) {
        return [];
      }

      return readdirSync(fullPath)
        .filter(file => statSync(join(fullPath, file)).isFile())
        .sort();
    } catch (error) {
      loggerService.error('Erro ao listar arquivos de output', error);
      return [];
    }
  }

  /**
   * Limpa arquivos de output antigos
   * @param {string} outputPath - Caminho do diretório
   * @param {number} maxAgeHours - Idade máxima em horas
   */
  cleanupOldFiles(outputPath, maxAgeHours = 24) {
    try {
      const fullPath = join(process.cwd(), outputPath);
      const maxAge = maxAgeHours * 60 * 60 * 1000; // converter para ms
      const now = Date.now();

      if (!existsSync(fullPath)) {
        return;
      }

      const files = readdirSync(fullPath);
      let cleaned = 0;

      for (const file of files) {
        const filePath = join(fullPath, file);
        const stats = statSync(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          unlinkSync(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        loggerService.info(`${cleaned} arquivos antigos removidos de ${outputPath}`);
      }

    } catch (error) {
      loggerService.error('Erro ao limpar arquivos antigos', error);
    }
  }
}

// Instância singleton do serviço
const fileOutputService = new FileOutputService();

export default fileOutputService;
export { FileOutputService };
