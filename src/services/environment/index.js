import { homedir } from 'os';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Serviço de Ambiente
 * Gerencia variáveis de ambiente e substituição de placeholders $ENV_*
 * Com suporte a criptografia de connection strings
 */

class EnvironmentService {
  constructor() {
    this.envCache = new Map(); // Cache de variáveis por origem
  }

  /**
   * Gera ou obtém a chave de criptografia
   * @returns {Buffer} Chave de 32 bytes para AES-256
   */
  getEncryptionKey() {
    let key = process.env.ENV_ENCRYPTION_KEY;
    
    if (!key) {
      // Gera chave automática se não existir
      key = randomBytes(32).toString('hex');
      console.warn(`⚠️ Chave de criptografia gerada automaticamente. Adicione ao seu .env:`);
      console.warn(`ENV_ENCRYPTION_KEY=${key}`);
      process.env.ENV_ENCRYPTION_KEY = key;
    }
    
    // Deriva chave de 32 bytes usando scrypt
    return scryptSync(key, 'gicli-salt', 32);
  }

  /**
   * Criptografa um texto usando AES-256-GCM
   * @param {string} text - Texto para criptografar
   * @returns {string} Texto criptografado no formato ENC:base64(iv+ciphertext+tag)
   */
  encrypt(text) {
    const key = this.getEncryptionKey();
    const iv = randomBytes(16); // IV para GCM
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Combina IV + ciphertext + auth tag
    const combined = Buffer.concat([iv, Buffer.from(encrypted, 'hex'), authTag]);
    return 'ENC:' + combined.toString('base64');
  }

  /**
   * Descriptografa um texto criptografado
   * @param {string} encryptedText - Texto no formato ENC:base64(...)
   * @returns {string} Texto descriptografado
   */
  decrypt(encryptedText) {
    if (!encryptedText.startsWith('ENC:')) {
      return encryptedText; // Não está criptografado
    }
    
    try {
      const key = this.getEncryptionKey();
      const combined = Buffer.from(encryptedText.slice(4), 'base64');
      
      const iv = combined.slice(0, 16);
      const authTag = combined.slice(-16);
      const ciphertext = combined.slice(16, -16);
      
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      throw new Error(`Falha ao descriptografar: ${error.message}`);
    }
  }

  /**
   * Carrega variáveis de ambiente para uma origem
   * Agora usa o sistema centralizado ~/.gicli/.env
   * @param {string} originName - Nome da origem
   */
  load(originName) {
    // Como usamos dotenv no import service, as variáveis já estão em process.env
    // Não precisamos mais carregar arquivos .env específicos por origem
    console.log(`Usando variáveis de ambiente do sistema para ${originName}`);
    
    // Mantém compatibilidade com código que espera cache por origem
    if (!this.envCache.has(originName)) {
      this.envCache.set(originName, {});
    }
  }

  /**
   * Substitui placeholders $ENV_* e template variables {{job_id.data.field}} no texto
   * @param {string} text - Texto com placeholders
   * @param {string} originName - Nome da origem (opcional)
   * @param {object} jobResults - Resultados de jobs anteriores (opcional, para templates)
   * @returns {string} Texto com substituições
   */
  substitute(text, originName = null, jobResults = {}) {
    if (typeof text !== 'string') return text;

    let result = text;

    // PRIMEIRO: Verifica se o resultado está criptografado e descriptografa
    if (result.startsWith('ENC:')) {
      try {
        result = this.decrypt(result);
      } catch (error) {
        console.warn(`Erro ao descriptografar valor: ${error.message}`);
        // Mantém o valor original se falhar a descriptografia
      }
    }

    // DEPOIS: Substitui $ENV_* (mantém comportamento existente)
    const envRegex = /\$ENV_([A-Z_][A-Z0-9_]*)/g;
    
    // DEBUG: Verificar se ENV_SQLSERVER_PASSWORD está em process.env
    console.log('DEBUG - ENV_SQLSERVER_PASSWORD em process.env:', process.env.ENV_SQLSERVER_PASSWORD);
    console.log('DEBUG - Texto antes da substituição:', result);
    
    result = result.replace(envRegex, (match, varName) => {
      const fullVarName = 'ENV_' + varName; // Adiciona prefixo ENV_ de volta
      
      // Primeiro tenta da origem específica
      if (originName) {
        const originVars = this.envCache.get(originName);
        if (originVars && originVars[fullVarName] !== undefined) {
          return originVars[fullVarName];
        }
      }

      // Depois tenta das variáveis de ambiente do sistema
      const systemVar = process.env[fullVarName];
      if (systemVar !== undefined) {
        return systemVar;
      }

      // Se não encontrou, deixa o placeholder
      console.warn(`Variável de ambiente não encontrada: ${fullVarName}`);
      return match;
    });

    // FINALMENTE: Substitui template variables {{job_id.data.field}}
    const templateRegex = /\{\{([^}]+)\}\}/g;
    result = result.replace(templateRegex, (match, templatePath) => {
      try {
        const value = this.resolveTemplatePath(templatePath, jobResults);
        return value !== undefined ? String(value) : match;
      } catch (error) {
        console.warn(`Erro ao resolver template ${templatePath}: ${error.message}`);
        return match;
      }
    });

    return result;
  }

  /**
   * Resolve um caminho de template como job_id.data.field
   * @param {string} templatePath - Caminho como "job_id.data.field" ou "job_id.data[0].field"
   * @param {object} jobResults - Resultados dos jobs
   * @returns {any} Valor resolvido ou undefined
   */
  resolveTemplatePath(templatePath, jobResults) {
    const parts = templatePath.trim().split('.');
    if (parts.length < 2) {
      throw new Error(`Template path deve ter pelo menos job_id.data: ${templatePath}`);
    }

    const jobId = parts[0];
    const jobResult = jobResults[jobId];

    if (!jobResult || !jobResult.data) {
      throw new Error(`Resultado do job ${jobId} não encontrado ou não possui dados`);
    }

    // Começa com os dados do job
    let current = jobResult.data;

    // Navega pelos campos restantes
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];

      // Trata arrays: data[0] ou data[0].field
      const arrayMatch = part.match(/^([^[\]]+)(\[(\d+)\])?$/);
      if (arrayMatch) {
        const [, field, , index] = arrayMatch;

        // Navega para o campo
        if (current && typeof current === 'object' && field in current) {
          current = current[field];
        } else {
          throw new Error(`Campo ${field} não encontrado em ${JSON.stringify(current)}`);
        }

        // Se tem índice, acessa o elemento do array
        if (index !== undefined) {
          const arrayIndex = parseInt(index, 10);
          if (Array.isArray(current)) {
            if (arrayIndex >= 0 && arrayIndex < current.length) {
              current = current[arrayIndex];
            } else {
              throw new Error(`Índice ${arrayIndex} fora dos limites do array`);
            }
          } else {
            throw new Error(`Campo ${field} não é um array`);
          }
        }
      } else {
        // Campo simples
        if (current && typeof current === 'object' && part in current) {
          current = current[part];
        } else {
          throw new Error(`Campo ${part} não encontrado`);
        }
      }
    }

    return current;
  }

  /**
   * Substitui placeholders em objetos aninhados
   * @param {any} obj - Objeto a processar
   * @param {string} originName - Nome da origem
   * @param {object} jobResults - Resultados de jobs anteriores (opcional, para templates)
   * @returns {any} Objeto com substituições
   */
  substituteDeep(obj, originName = null, jobResults = {}) {
    if (typeof obj === 'string') {
      return this.substitute(obj, originName, jobResults);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.substituteDeep(item, originName, jobResults));
    }

    if (obj && typeof obj === 'object') {
      const result = {};

      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteDeep(value, originName, jobResults);
      }

      return result;
    }

    return obj;
  }

  /**
   * Valida se todas as variáveis necessárias estão presentes
   * @param {string[]} requiredVars - Lista de variáveis obrigatórias
   * @param {string} originName - Nome da origem
   * @returns {object} Resultado da validação
   */
  validate(requiredVars, originName = null) {
    const missing = [];
    const found = [];

    for (const varName of requiredVars) {
      let value = null;

      // Primeiro tenta da origem específica
      if (originName) {
        const originVars = this.envCache.get(originName);
        if (originVars && originVars[varName] !== undefined) {
          value = originVars[varName];
        }
      }

      // Depois tenta das variáveis de ambiente do sistema
      if (value === null) {
        value = process.env[varName];
      }

      if (value === undefined || value === null) {
        missing.push(varName);
      } else {
        found.push(varName);
      }
    }

    return {
      valid: missing.length === 0,
      missing,
      found
    };
  }

  /**
   * Obtém valor de uma variável
   * @param {string} varName - Nome da variável
   * @param {string} originName - Nome da origem (opcional)
   * @returns {string|null} Valor ou null se não encontrado
   */
  get(varName, originName = null) {
    // Primeiro tenta da origem específica
    if (originName) {
      const originVars = this.envCache.get(originName);
      if (originVars && originVars[varName] !== undefined) {
        return originVars[varName];
      }
    }

    // Depois tenta das variáveis de ambiente do sistema
    return process.env[varName] || null;
  }

  /**
   * Lista variáveis carregadas para uma origem
   * @param {string} originName - Nome da origem
   * @returns {string[]} Lista de variáveis
   */
  list(originName) {
    const originVars = this.envCache.get(originName);
    return originVars ? Object.keys(originVars) : [];
  }
}

// Instância singleton do serviço
const environmentService = new EnvironmentService();

export default environmentService;
export { EnvironmentService };
