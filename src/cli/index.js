#!/usr/bin/env node

import importService from '../services/import/index.js';
import executionService from '../services/execution/index.js';
import transportService from '../services/transport/index.js';
import fileOutputService from '../services/file-output/index.js';
import loggerService from '../services/logger/index.js';
import { DependencyResolver } from '../services/dependency-resolver/index.js';
import sessionService from '../services/session/index.js';
import environmentService from '../services/environment/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const args = process.argv.slice(2);

// Ler informações do package.json do próprio módulo
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageInfo = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

function showHelp() {
  console.log(`Uso: gicli [OPÇÃO]...
gicli v${packageInfo.version} - Gestor de integrações.

Argumentos disponíveis:
  -p, --production    Executa o job em modo produção
  -t, --test          Executa o job em modo teste
  -j, --job           Nome do job a ser executado
  -i, --import        Importa e valida configurações
  -v, --validate      Valida configurações sem executar jobs
  -d, --dir           Diretório de configurações (padrão: docs/)
  -f, --file          Arquivo de configuração específico
  -s, --silent        Reduz as mensagens de saída na tela
  -h, --help          Exibe esta mensagem de ajuda`);
}

/**
 * Processa saída do job baseado na configuração
 * @param {object} jobConfig - Configuração do job
 * @param {object} jobResult - Resultado da execução
 * @param {object} originConfig - Configuração da origem
 * @param {string} mode - Modo de execução
 * @param {boolean} silent - Se deve ser silencioso
 */
async function processJobOutput(jobConfig, jobResult, originConfig, mode, silent) {
  if (!jobConfig.output?.enabled) {
    return null;
  }

  try {
    const outputType = jobConfig.output.type || 'file';

    if (outputType === 'database') {
      if (!silent) {
        console.log('Processando saída para banco de dados...');
      }

      // Usa connection_string do job ou fallback para connection_string da origem
      const connectionString = jobConfig.output.connection_string || originConfig.connection_string;
      
      if (!connectionString) {
        throw new Error(`Connection string não encontrada para job ${jobConfig.id}`);
      }

      console.log(`[DEBUG] Connection string antes da substituição: ${connectionString}`);

      // Aplica substituição de variáveis de ambiente na connection_string
      const connectionStringSubstituted = environmentService.substitute(connectionString, originConfig.name);

      console.log(`[DEBUG] Connection string após substituição: ${connectionStringSubstituted}`);

      await transportService.connect(jobConfig.output.driver, connectionStringSubstituted);
      const outputResult = await transportService.processDatabaseOutput(
        jobResult.response.data,
        jobConfig.output,
        {
          originName: originConfig.name,
          timestamp: new Date().toISOString(),
          mode,
          jobId: jobConfig.id
        },
        originConfig
      );
      await transportService.disconnect();

      return outputResult;

    } else {
      // Saída para arquivo (padrão)
      if (!silent) {
        console.log('Processando saída para arquivo...');
      }

      const outputResult = await fileOutputService.processOutput(
        { data: jobResult.response.data, headers: jobResult.response.headers, status: jobResult.response.status },
        jobConfig,
        {
          originName: originConfig.name,
          timestamp: new Date().toISOString(),
          mode
        }
      );

      return outputResult;
    }
  } catch (outputError) {
    console.warn(`Aviso: Falha ao processar saída para job ${jobConfig.id}:`, outputError.message);
    return { success: false, error: outputError.message };
  }
}

// Parse arguments
let mode = null;
let jobName = null;
let importConfigs = false;
let validateOnly = false;
let verbose = false;
let silent = false;
let configDir = null;
let configFile = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  switch (arg) {
    case '-p':
    case '--production':
      mode = 'production';
      break;
    case '-t':
    case '--test':  
      mode = 'test';
      break;
    case '-j':
    case '--job':
      jobName = args[++i];
      break;
    case '-d':
    case '--dir':
      configDir = args[++i];
      break;
    case '-f':
    case '--file':
      configFile = args[++i];
      break;
    case '-h':
    case '--help':
      showHelp();
      process.exit(0);
      break;
    case '-i':
    case '--import':
      importConfigs = true;
      break;
    case '-v':
    case '--validate':
      validateOnly = true;
      break;
    case '-s':
    case '--silent':
      silent = true;
      break;
    default:
      console.error(`Argumento desconhecido: ${arg}`);
      showHelp();
      process.exit(1);
  }
}

if (args.length === 0) {
  showHelp();
  process.exit(0);
}

// Configura logger baseado no modo silent
if (silent) {
  loggerService.setSilent(true);
}

// Em modo produção, sempre silencioso
if (mode === 'production') {
  loggerService.setSilent(true);
}

if (importConfigs) {
  try {
    await importService.loadConfigurations(false, configDir, configFile);
    if (!silent) {
      console.log('Configurações importadas e validadas com sucesso.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Erro ao importar configurações:', error.message);
    process.exit(1);
  }
} else if (validateOnly) {
  try {
    await importService.loadConfigurations(true, configDir, configFile);
    if (!silent) {
      console.log('Configurações validadas com sucesso.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Erro ao validar configurações:', error.message);
    process.exit(1);
  }
} else if (mode && jobName) {
  // Execute job com sistema de dependências
  try {
    // Carrega configurações
    await importService.loadConfigurations(false, configDir, configFile);

    // Encontra o job na configuração
    const targetJob = importService.getJobById(jobName);

    if (!targetJob) {
      throw new Error(`Job '${jobName}' não encontrado nas configurações`);
    }

    // Encontra a origem do job
    const originConfig = importService.getOriginForJob(jobName);

    if (!originConfig) {
      throw new Error(`Origem para job '${jobName}' não encontrada`);
    }

    // Carrega variáveis de ambiente da origem
    environmentService.load(originConfig.name);

    // Cria resolvedor de dependências
    const dependencyResolver = new DependencyResolver();

    // Obtém todos os jobs da origem
    const allJobs = originConfig.job || [];

    // Resolve ordem de execução baseada em dependências
    const executionOrder = dependencyResolver.resolveExecutionOrder(allJobs, jobName);

    if (!silent) {
      console.log(`Ordem de execução resolvida: ${executionOrder.join(' → ')}`);
    }

    // Cache para armazenar resultados dos jobs
    const jobResults = {};

    // Executa jobs em ordem de dependências
    for (const jobId of executionOrder) {
      const jobConfig = allJobs.find(job => job.id === jobId);

      if (!silent) {
        console.log(`Executando job: ${jobId}`);
      }

      // Aplica template variables e substituições de ambiente
      let processedJobConfig = environmentService.substituteDeep(jobConfig, originConfig.name, jobResults);

      // Executa o job
      const result = await executionService.executeJob(originConfig, processedJobConfig, mode, silent);

      if (result.success) {
        // Armazena resultado na sessão para uso por jobs dependentes
        const sessionKey = `job_result_${jobId}`;
        sessionService.set(sessionKey, {
          data: result.response.data,
          headers: result.response.headers,
          status: result.response.status,
          timestamp: result.response.timestamp
        }, 3600000); // 1 hora de TTL

        // Também armazena em jobResults para template resolution
        jobResults[jobId] = {
          data: result.response.data,
          headers: result.response.headers,
          status: result.response.status,
          timestamp: result.response.timestamp
        };

        if (!silent) {
          console.log(`Job '${jobId}' executado com sucesso`);
        }

        // Processa saída se configurado
        const outputResult = await processJobOutput(processedJobConfig, result, originConfig, mode, silent);

        // Se for modo teste E não silencioso, mostra resultado
        if (mode === 'test' && !silent) {
          const resultToShow = { ...result };
          if (outputResult) {
            resultToShow.output = outputResult;
          }
          console.log(`Resultado de ${jobId}:`, JSON.stringify(resultToShow, null, 2));
        }

      } else {
        throw new Error(`Falha no job ${jobId}: ${result.error}`);
      }
    }

    if (!silent) {
      console.log(`Todos os jobs executados com sucesso. Job alvo: ${jobName}`);
    }
    process.exit(0);

  } catch (error) {
    console.error('Erro executando job:', error.message);
    process.exit(1);
  }
} else {
  console.error('Argumentos inválidos.');
  showHelp();
  process.exit(1);
}