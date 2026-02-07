import { readdirSync, readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, isAbsolute } from 'path';
import { execSync } from 'child_process';
import { homedir } from 'os';
import validatorService from '../validator/index.js';
import dotenv from 'dotenv';

/**
 * Serviço de Importação de Configurações
 * Responsável por carregar e gerenciar arquivos de configuração JSON
 */
class ImportService {
  constructor() {
    this.configs = new Map(); // Armazena configurações carregadas
    this.configPath = '/etc/gicli';
    this.validatedPath = '/etc/gicli';
    this.processedVariables = new Set(); // Evita notificações duplicadas

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
   * Carrega variáveis de ambiente do arquivo .env
   */
  loadEnvironmentVariables() {
    const envPath = join(homedir(), '.gicli', '.env');
    
    if (existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log('Variáveis de ambiente carregadas do .env');
    }
  }

  /**
   * Carrega todas as configurações JSON da pasta especificada (padrão: docs/)
   * @param {boolean} validateOnly - Se true, apenas valida sem salvar arquivos
   * @param {string} configPath - Caminho para o diretório de configurações
   * @param {string} configFile - Caminho para um arquivo específico (opcional)
   */
  async loadConfigurations(validateOnly = false, configPath = null, configFile = null) {
    // Carrega variáveis de ambiente do .env
    this.loadEnvironmentVariables();
    
    if (configFile) {
      // Carregar arquivo específico
      const result = await this.loadConfigurationFromFile(configFile, validateOnly);
      // Processa variáveis de ambiente do arquivo carregado
      const groupName = configFile.split('/').pop().split('\\').pop().replace('.json', '').toUpperCase();
      const configFilePath = isAbsolute(configFile) ? configFile : join(process.cwd(), configFile);
      this.processEnvironmentVariables(configFilePath, groupName);
      return result;
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
        // Processa variáveis de ambiente do arquivo de configuração
        const configFilePath = join(targetPath, dir.name, `${dir.name}.json`);
        if (existsSync(configFilePath)) {
          this.processEnvironmentVariables(configFilePath, dir.name.toUpperCase());
        }
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
          // Processa variáveis de ambiente do arquivo validado
          const groupName = file.replace('.json', '').toUpperCase();
          this.processEnvironmentVariables(filePath, groupName);
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
    const fullPath = isAbsolute(filePath) ? filePath : join(process.cwd(), filePath);

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
   * Lista os nomes dos jobs de uma origem específica
   * @param {string} originName - Nome da origem
   * @returns {string[]} Lista de nomes dos jobs ou array vazio se não encontrada
   */
  listJobNamesByOrigin(originName) {
    for (const [groupName, config] of this.configs) {
      if (config.origins) {
        const origin = config.origins.find(o => o.name === originName);
        if (origin && origin.job) {
          return origin.job.map(job => job.name);
        }
      }
    }
    return [];
  }

  /**
   * Lista os IDs dos jobs de uma origem específica
   * @param {string} originName - Nome da origem
   * @returns {string[]} Lista de IDs dos jobs ou array vazio se não encontrada
   */
  listJobIdsByOrigin(originName) {
    for (const [groupName, config] of this.configs) {
      if (config.origins) {
        const origin = config.origins.find(o => o.name === originName);
        if (origin && origin.job) {
          return origin.job.map(job => job.id);
        }
      }
    }
    return [];
  }

  /**
   * Recarrega todas as configurações
   */
  async reloadConfigurations() {
    this.configs.clear();
    return await this.loadConfigurations();
  }

  /**
   * Cria o diretório .gicli na home do usuário se não existir
   */
  createGicliDirectory() {
    const homeDir = homedir();
    const gicliDir = join(homeDir, '.gicli');
    
    if (!existsSync(gicliDir)) {
      mkdirSync(gicliDir, { recursive: true });
      console.log(`Diretório criado: ${gicliDir}`);
    }
    
    return gicliDir;
  }

  /**
   * Cria o arquivo .env no diretório .gicli se não existir
   */
  createEnvFile() {
    const gicliDir = this.createGicliDirectory();
    const envPath = join(gicliDir, '.env');
    
    if (!existsSync(envPath)) {
      writeFileSync(envPath, '# Variáveis de ambiente do GICLI\n');
      console.log(`Arquivo .env criado: ${envPath}`);
    }
    
    return envPath;
  }

  /**
   * Extrai variáveis de ambiente de um objeto JSON que começam com $
   * @param {Object} obj - Objeto JSON para analisar
   * @param {Array} variables - Array para acumular variáveis encontradas
   */
  extractEnvVariables(obj, variables = []) {
    for (const key in obj) {
      if (typeof obj[key] === 'string' && obj[key].startsWith('$')) {
        const envVar = obj[key].substring(1);
        if (/^[A-Z_][A-Z0-9_]*$/.test(envVar) && !variables.includes(envVar)) {
          variables.push(envVar);
        }
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        this.extractEnvVariables(obj[key], variables);
      }
    }
    return variables;
  }

  /**
   * Adiciona variáveis de ambiente ao arquivo .env sem sobrescrever existentes
   * @param {Array} newVariables - Array de variáveis para adicionar
   * @param {string} groupName - Nome do grupo para comentário no .env
   */
  addToEnvFile(newVariables, groupName = 'Geral') {
    const envPath = this.createEnvFile();
    const envContent = readFileSync(envPath, 'utf8');
    const existingVars = new Set();
    
    // Extrair variáveis existentes do arquivo .env
    const lines = envContent.split('\n');
    lines.forEach(line => {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        existingVars.add(match[1]);
      }
    });
    
    // Adicionar novas variáveis que não existem e não foram processadas antes
    const varsToAdd = newVariables.filter(varName => 
      !existingVars.has(varName) && !this.processedVariables.has(varName)
    );
    
    if (varsToAdd.length > 0) {
      const newContent = envContent + 
                        `\n# Variáveis do grupo ${groupName}\n` + 
                        varsToAdd.map(varName => `${varName}=`).join('\n') + '\n';
      writeFileSync(envPath, newContent);
      console.log(`Variáveis adicionadas ao .env (${groupName}): ${varsToAdd.join(', ')}`);
      
      // Marcar como processadas
      varsToAdd.forEach(varName => this.processedVariables.add(varName));
    }
    
    return varsToAdd;
  }

  /**
   * Informa ao usuário sobre variáveis que precisam ser preenchidas
   * @param {Array} variables - Array de variáveis que precisam de valor
   */
  notifyUserToFillVariables(variables) {
    // Filtrar apenas variáveis que não existem no process.env
    const varsNeedingValue = variables.filter(varName => !process.env[varName]);
    
    if (varsNeedingValue.length > 0) {
      console.log('\n=== ATENÇÃO ===');
      console.log('As seguintes variáveis de ambiente precisam ser configuradas:');
      varsNeedingValue.forEach(varName => {
        console.log(`  - ${varName}`);
      });
      console.log(`\nEdite o arquivo .env em: ${join(homedir(), '.gicli', '.env')}`);
      console.log('Adicione os valores correspondentes às variáveis acima.\n');
    }
  }

  /**
   * Processa um arquivo JSON e configura variáveis de ambiente automaticamente
   * @param {string} jsonFilePath - Caminho do arquivo JSON para processar
   * @param {string} groupName - Nome do grupo para organização no .env
   */
  processEnvironmentVariables(jsonFilePath, groupName = 'Geral') {
    try {
      if (!existsSync(jsonFilePath)) {
        console.log(`Arquivo JSON não encontrado: ${jsonFilePath}`);
        return [];
      }
      
      const jsonContent = JSON.parse(readFileSync(jsonFilePath, 'utf8'));
      const envVariables = this.extractEnvVariables(jsonContent);
      const addedVariables = this.addToEnvFile(envVariables, groupName);
      
      if (addedVariables.length > 0) {
        this.notifyUserToFillVariables(addedVariables);
      }
      
      return addedVariables;
    } catch (error) {
      console.error(`Erro ao processar variáveis de ambiente: ${error.message}`);
      return [];
    }
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
