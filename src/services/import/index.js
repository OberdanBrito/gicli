import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import validatorService from '../validator/index.js';

/**
 * Serviço de Importação de Configurações
 * Responsável por carregar e gerenciar arquivos de configuração JSON
 */
class ImportService {
  constructor() {
    this.configs = new Map(); // Armazena configurações carregadas
    this.configPath = join(process.cwd(), 'docs');
    this.validatedPath = join(process.cwd(), 'src/config');

    // Garante que o diretório de configurações validadas existe
    if (!existsSync(this.validatedPath)) {
      mkdirSync(this.validatedPath, { recursive: true });
    }
  }

  /**
   * Carrega todas as configurações JSON da pasta especificada (padrão: docs/)
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar arquivos
   * @param {string} configPath - Caminho para o diretório de configurações
   */
  async loadConfigurations(validateOnly = false, configPath = null) {
    const targetPath = configPath ? join(process.cwd(), configPath) : this.configPath;
    try {
      if (!existsSync(targetPath)) {
        throw new Error(`Diretório de configurações não encontrado: ${targetPath}`);
      }

      const entries = readdirSync(targetPath, { withFileTypes: true });
      const configDirs = entries.filter(entry => entry.isDirectory());

      for (const dir of configDirs) {
        await this.loadConfigFromDirectory(dir.name, validateOnly, targetPath);
      }

      console.log(`${this.configs.size} configurações carregadas com sucesso`);
      return true;
    } catch (error) {
      console.error('Erro ao carregar configurações:', error.message);
      throw error;
    }
  }

  /**
   * Carrega configurações de um diretório específico
   * @param {string} dirName - Nome do diretório
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar
   * @param {string} basePath - Caminho base para o diretório
   */
  async loadConfigFromDirectory(dirName, validateOnly = false, basePath = null) {
    const dirPath = join(basePath || this.configPath, dirName);
    const files = readdirSync(dirPath);

    // Procura por arquivo JSON principal (normalmente nomeado como o diretório)
    const configFile = files.find(file =>
      file.endsWith('.json') && file.includes(dirName)
    );

    if (!configFile) {
      console.warn(`Nenhum arquivo de configuração encontrado em ${dirName}`);
      return;
    }

    const filePath = join(dirPath, configFile);

    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);

      // Validação da configuração
      const validation = validatorService.validateConfiguration(config);

      if (!validation.valid) {
        console.error(`Configuração inválida em ${configFile}:`);
        validation.errors.forEach(error => {
          console.error(`  - ${error.instancePath || 'root'}: ${error.message}`);
        });
        throw new Error(`Configuração inválida em ${configFile}`);
      }

      if (validateOnly) {
        console.log(`Configuração '${config.group}' validada (modo apenas validação)`);
      } else {
        // Configuração válida, salvar no diretório validado
        const validatedFilePath = join(this.validatedPath, configFile);
        copyFileSync(filePath, validatedFilePath);
        console.log(`Configuração '${config.group}' validada e salva em ${validatedFilePath}`);

        // Armazena configuração usando o group como chave
        this.configs.set(config.group, {
          ...config,
          _metadata: {
            file: configFile,
            path: filePath,
            validatedPath: validatedFilePath,
            loadedAt: new Date().toISOString(),
            validatedAt: new Date().toISOString()
          }
        });
      }

      console.log(`Configuração '${config.group}' carregada de ${configFile}`);
    } catch (error) {
      console.error(`Erro ao carregar ${configFile}:`, error.message);
      throw error;
    }
  }

  /**
   * Obtém uma configuração pelo nome do grupo
   * @param {string} groupName - Nome do grupo
   * @returns {object|null} Configuração ou null se não encontrada
   */
  getConfiguration(groupName) {
    return this.configs.get(groupName) || null;
  }

  /**
   * Lista todos os grupos de configuração disponíveis
   * @returns {string[]} Lista de nomes dos grupos
   */
  listConfigurations() {
    return Array.from(this.configs.keys());
  }

  /**
   * Obtém um job por ID
   * @param {string} jobId - ID do job
   * @returns {object|null} Configuração do job ou null
   */
  getJobById(jobId) {
    for (const [groupName, config] of this.configs) {
      if (config.origins) {
        for (const origin of config.origins) {
          if (origin.job) {
            const job = origin.job.find(j => j.id === jobId);
            if (job) return job;
          }
        }
      }
    }
    return null;
  }

  /**
   * Obtém a origem de um job por ID
   * @param {string} jobId - ID do job
   * @returns {object|null} Configuração da origem ou null
   */
  getOriginForJob(jobId) {
    for (const [groupName, config] of this.configs) {
      if (config.origins) {
        for (const origin of config.origins) {
          if (origin.job) {
            const hasJob = origin.job.some(j => j.id === jobId);
            if (hasJob) return origin;
          }
        }
      }
    }
    return null;
  }

  /**
   * Recarrega todas as configurações
   */
  async reloadConfigurations() {
    this.configs.clear();
    return await this.loadConfigurations();
  }

  /**
   * Obtém estatísticas das configurações carregadas
   * @returns {object} Estatísticas
   */
  getStats() {
    const stats = {
      totalConfigurations: this.configs.size,
      groups: this.listConfigurations(),
      details: []
    };

    for (const [group, config] of this.configs) {
      stats.details.push({
        group,
        origins: config.origins?.length || 0,
        file: config._metadata?.file,
        loadedAt: config._metadata?.loadedAt
      });
    }

    return stats;
  }
}

// Instância singleton do serviço
const importService = new ImportService();

export default importService;
export { ImportService };
