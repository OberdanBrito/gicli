import Ajv from 'ajv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * Serviço de Validação
 * Responsável por validar configurações JSON contra esquema definido
 */
class ValidatorService {
  constructor() {
    this.ajv = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false
    });
    this.schemaPath = join(dirname(fileURLToPath(import.meta.url)), 'schema.json');
    this.validateFunction = null;
    this.loadSchema();
  }

  /**
   * Carrega o esquema JSON de validação
   */
  loadSchema() {
    try {
      const schemaContent = readFileSync(this.schemaPath, 'utf-8');
      const schema = JSON.parse(schemaContent);
      this.validateFunction = this.ajv.compile(schema);
      console.log('Esquema de validação carregado com sucesso');
    } catch (error) {
      console.error('Erro ao carregar esquema de validação:', error.message);
      throw error;
    }
  }

  /**
   * Valida uma configuração JSON
   * @param {object} config - Configuração a ser validada
   * @returns {object} Resultado da validação
   */
  validateConfiguration(config) {
    if (!this.validateFunction) {
      throw new Error('Esquema de validação não carregado');
    }

    const valid = this.validateFunction(config);

    if (valid) {
      return {
        valid: true,
        errors: null
      };
    } else {
      return {
        valid: false,
        errors: this.validateFunction.errors
      };
    }
  }

  /**
   * Valida múltiplas configurações
   * @param {Map} configs - Mapa de configurações
   * @returns {object} Resultados da validação
   */
  validateAllConfigurations(configs) {
    const results = {
      total: configs.size,
      valid: 0,
      invalid: 0,
      details: []
    };

    for (const [groupName, config] of configs) {
      const validation = this.validateConfiguration(config);

      results.details.push({
        group: groupName,
        valid: validation.valid,
        errors: validation.errors
      });

      if (validation.valid) {
        results.valid++;
      } else {
        results.invalid++;
      }
    }

    return results;
  }
}

// Instância singleton do serviço
const validatorService = new ValidatorService();

export default validatorService;
export { ValidatorService };
