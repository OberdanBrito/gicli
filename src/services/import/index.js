import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import validatorService from '../validator/index.js';

/**
 * Serviço de Importação de Configurações
 * Responsável por carregar e gerenciar arquivos de configuração JSON
 */
class ImportService {
  constructor() {
    this.configs = new Map(); // Armazena configurações carregadas
    this.configPath = join(process.cwd(), 'docs');
    this.validatedPath = '/etc/gicli';

    // Garante que o diretório de configurações validadas existe
    try {
      if (!existsSync(this.validatedPath)) {
        mkdirSync(this.validatedPath, { recursive: true });
      }
    } catch (error) {
      console.warn(`Não foi possível criar ${this.validatedPath}:`, error.message);
      console.warn('Tentando usar sudo...');
      try {
        execSync(`sudo mkdir -p ${this.validatedPath}`, { stdio: 'inherit' });
        execSync(`sudo chown ${process.env.USER || 'root'} ${this.validatedPath}`, { stdio: 'inherit' });
      } catch (sudoError) {
        console.error('Erro ao criar diretório com sudo:', sudoError.message);
        throw new Error(`Não foi possível criar diretório de configurações: ${this.validatedPath}`);
      }
    }
  }

  /**
   * Carrega todas as configurações JSON da pasta especificada (padrão: docs/)
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar arquivos
   * @param {string} configPath - Caminho para o diretório de configurações
   * @param {string} configFile - Caminho para um arquivo específico (opcional)
   */
  async loadConfigurations(validateOnly = false, configPath = null, configFile = null) {
    if (configFile) {
      // Carregar arquivo específico
      return await this.loadConfigurationFromFile(configFile, validateOnly);
    }

    // Carregar todos os arquivos do diretório
    const targetPath = configPath ? join(process.cwd(), configPath) : this.configPath;
    try {
      if (!existsSync(targetPath)) {
        console.log(`Diretório ${targetPath} não encontrado. Tentando carregar configurações validadas de ${this.validatedPath}...`);
        return await this.loadConfigurationsFromValidatedPath(validateOnly);
      }

      const entries = readdirSync(targetPath, { withFileTypes: true });
      const configDirs = entries.filter(entry => entry.isDirectory());

      if (configDirs.length === 0) {
        console.log(`Nenhum diretório de configuração encontrado em ${targetPath}. Tentando carregar configurações validadas de ${this.validatedPath}...`);
        return await this.loadConfigurationsFromValidatedPath(validateOnly);
      }

      for (const dir of configDirs) {
        await this.loadConfigFromDirectory(dir.name, validateOnly, targetPath);
      }

      if (this.configs.size === 0) {
        console.log(`Nenhuma configuração válida encontrada em ${targetPath}. Tentando carregar configurações validadas de ${this.validatedPath}...`);
        return await this.loadConfigurationsFromValidatedPath(validateOnly);
      }

      console.log(`${this.configs.size} configurações carregadas com sucesso`);
      return true;
    } catch (error) {
      console.error('Erro ao carregar configurações:', error.message);
      throw error;
    }
  }

  /**
   * Carrega configurações validadas diretamente de /etc/gicli
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar arquivos
   */
  async loadConfigurationsFromValidatedPath(validateOnly = false) {
    try {
      if (!existsSync(this.validatedPath)) {
        throw new Error(`Diretório de configurações validadas não encontrado: ${this.validatedPath}`);
      }

      const files = readdirSync(this.validatedPath);

      if (files.length === 0) {
        throw new Error(`Nenhum arquivo de configuração encontrado em ${this.validatedPath}`);
      }

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(this.validatedPath, file);
          await this.loadValidatedConfigurationFromFile(filePath, validateOnly);
        }
      }

      if (this.configs.size === 0) {
        throw new Error(`Nenhuma configuração válida encontrada em ${this.validatedPath}`);
      }

      console.log(`${this.configs.size} configurações validadas carregadas de ${this.validatedPath}`);
      return true;
    } catch (error) {
      console.error('Erro ao carregar configurações validadas:', error.message);
      throw error;
    }
  }
  async loadConfigurationFromFile(filePath, validateOnly = false) {
    const fullPath = join(process.cwd(), filePath);

    try {
      if (!existsSync(fullPath)) {
        throw new Error(`Arquivo de configuração não encontrado: ${fullPath}`);
      }

      const content = readFileSync(fullPath, 'utf-8');
      const config = JSON.parse(content);

      // Validação da configuração
      const validation = validatorService.validateConfiguration(config);

      if (!validation.valid) {
        console.error(`Configuração inválida em ${filePath}:`);
        validation.errors.forEach(error => {
          console.error(`  - ${error.instancePath || 'root'}: ${error.message}`);
        });
        throw new Error(`Configuração inválida em ${filePath}`);
      }

      if (validateOnly) {
        console.log(`Configuração '${config.group}' validada (modo apenas validação)`);
      } else {
        // Configuração válida, salvar no diretório validado
        const configFile = filePath.split('/').pop() || filePath.split('\\').pop();
        const validatedFilePath = join(this.validatedPath, configFile);
        try {
          copyFileSync(fullPath, validatedFilePath);
        } catch (copyError) {
          console.warn(`Falha ao copiar para ${validatedFilePath}:`, copyError.message);
          console.warn('Tentando usar sudo...');
          try {
            execSync(`sudo cp "${fullPath}" "${validatedFilePath}"`, { stdio: 'inherit' });
            execSync(`sudo chown ${process.env.USER || 'root'} "${validatedFilePath}"`, { stdio: 'inherit' });
          } catch (sudoError) {
            console.error('Erro ao copiar com sudo:', sudoError.message);
            throw new Error(`Não foi possível salvar configuração validada: ${validatedFilePath}`);
          }
        }
        console.log(`Configuração '${config.group}' validada e salva em ${validatedFilePath}`);

        // Armazena configuração usando o group como chave
        this.configs.set(config.group, {
          ...config,
          _metadata: {
            file: configFile,
            path: fullPath,
            validatedPath: validatedFilePath,
            loadedAt: new Date().toISOString(),
            validatedAt: new Date().toISOString()
          }
        });
      }

      console.log(`Configuração '${config.group}' carregada de ${filePath}`);
      return true;
    } catch (error) {
      console.error(`Erro ao carregar ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Carrega configuração validada de um arquivo (já validado anteriormente)
   * @param {string} filePath - Caminho completo para o arquivo validado
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar
   */
  async loadValidatedConfigurationFromFile(filePath, validateOnly = false) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);

      if (validateOnly) {
        console.log(`Configuração '${config.group}' validada (modo apenas validação)`);
      } else {
        // Armazena configuração usando o group como chave
        this.configs.set(config.group, {
          ...config,
          _metadata: {
            file: filePath.split('/').pop() || filePath.split('\\').pop(),
            path: filePath,
            validatedPath: filePath,
            loadedAt: new Date().toISOString(),
            validatedAt: config._metadata?.validatedAt || new Date().toISOString()
          }
        });
      }

      console.log(`Configuração '${config.group}' carregada de ${filePath}`);
    } catch (error) {
      console.error(`Erro ao carregar configuração validada ${filePath}:`, error.message);
      throw error;
    }
  }
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
        try {
          copyFileSync(filePath, validatedFilePath);
        } catch (copyError) {
          console.warn(`Falha ao copiar para ${validatedFilePath}:`, copyError.message);
          console.warn('Tentando usar sudo...');
          try {
            execSync(`sudo cp "${filePath}" "${validatedFilePath}"`, { stdio: 'inherit' });
            execSync(`sudo chown ${process.env.USER || 'root'} "${validatedFilePath}"`, { stdio: 'inherit' });
          } catch (sudoError) {
            console.error('Erro ao copiar com sudo:', sudoError.message);
            throw new Error(`Não foi possível salvar configuração validada: ${validatedFilePath}`);
          }
        }
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
