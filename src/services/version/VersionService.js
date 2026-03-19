import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import BaseService from '../../commons/baseService.js';

/**
 * Serviço para gerenciamento de versão da aplicação
 * Herda de BaseService para garantir uso obrigatório de logging
 */
class VersionService extends BaseService {
  constructor() {
    super();
  }

  /**
   * Obtém a versão da aplicação lendo dinamicamente do package.json
   * @returns {string} Versão da aplicação
   */
  getVersion() {
    try {
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const packagePath = join(__dirname, '../../../package.json');

      const packageInfo = JSON.parse(readFileSync(packagePath, 'utf-8'));
      const version = packageInfo.version;

      return version;
    } catch (error) {
      this.logError('obtenção de versão', error);
      throw error;
    }
  }
}

export default VersionService;
