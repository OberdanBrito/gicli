import { homedir } from 'os';

/**
 * Serviço de Ambiente
 * Gerencia variáveis de ambiente e substituição de placeholders $ENV_*
 */

class EnvironmentService {
  constructor() {
    this.envCache = new Map(); // Cache de variáveis por origem
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

    // Primeiro substitui $ENV_* (mantém comportamento existente)
    const envRegex = /\$ENV_([A-Z_][A-Z0-9_]*)/g;
    result = result.replace(envRegex, (match, varName) => {
      // Primeiro tenta da origem específica
      if (originName) {
        const originVars = this.envCache.get(originName);
        if (originVars && originVars[varName] !== undefined) {
          return originVars[varName];
        }
      }

      // Depois tenta das variáveis de ambiente do sistema
      const systemVar = process.env[varName];
      if (systemVar !== undefined) {
        return systemVar;
      }

      // Se não encontrou, deixa o placeholder
      console.warn(`Variável de ambiente não encontrada: ${varName}`);
      return match;
    });

    // Depois substitui template variables {{job_id.data.field}}
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
