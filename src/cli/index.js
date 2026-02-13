#!/usr/bin/env node

import importService from '../services/import/index.js';
import executionService from '../services/execution/index.js';
import transportService from '../services/transport/index.js';
import fileOutputService from '../services/file-output/index.js';
import loggerService from '../services/logger/index.js';
import { DependencyResolver } from '../services/dependency-resolver/index.js';
import sessionService from '../services/session/index.js';
import environmentService from '../services/environment/index.js';
import swaggerGeneratorService from '../services/swagger-generator/index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Set dotenvx quiet mode to suppress messages
process.env.DOTENVX_QUIET = '1';
process.env.DOTENV_SUPPRESS_DEBUG_MESSAGES = 'true';

const args = process.argv.slice(2);

// Verificar comandos de criptografia antes do parsing normal
if (args[0] === 'encrypt' || args[0] === 'decrypt') {
  await handleCryptCommand(args[0], args[1]);
  process.exit(0);
}

// Verificar comando generate-config
if (args[0] === 'generate-config') {
  await handleGenerateConfigCommand(args.slice(1));
  process.exit(0);
}

// Verificar comando list
if (args[0] === 'list') {
  const tipo = args[1];
  const origem = args[2];
  if (!tipo || !origem) {
    console.error('Uso: gicli list <tipo> <origem>');
    console.log('Tipos disponíveis: names, ids');
    process.exit(1);
  }
  try {
    await importService.loadConfigurations(false, null, null);
    let jobList;
    if (tipo === 'names') {
      jobList = importService.listJobNamesByOrigin(origem);
    } else if (tipo === 'ids') {
      jobList = importService.listJobIdsByOrigin(origem);
    } else {
      console.error(`Tipo inválido: ${tipo}. Use 'names' ou 'ids'.`);
      process.exit(1);
    }
    if (jobList.length === 0) {
      console.log(`Nenhum job encontrado para a origem '${origem}'.`);
    } else {
      console.log(`Jobs da origem '${origem}':`);
      jobList.forEach(job => console.log(`  - ${job}`));
    }
    process.exit(0);
  } catch (error) {
    console.error('Erro ao listar jobs:', error.message);
    process.exit(1);
  }
}

// Ler informações do package.json do próprio módulo
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageInfo = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));

async function showHelp() {
  const { getHelpText } = await import('./help-template.js');
  console.log(getHelpText(packageInfo));
}

/**
 * Lida com comandos de criptografia/descriptografia
 * @param {string} command - 'encrypt' ou 'decrypt'
 * @param {string} text - Texto para processar (opcional, lê do stdin se não fornecido)
 */
async function handleCryptCommand(command, text) {
  try {
    // Carrega variáveis de ambiente para garantir ENV_ENCRYPTION_KEY
    await importService.loadConfigurations(false, null, null);
    
    // Se não foi fornecido texto, lê do stdin
    if (!text) {
      text = await readFromStdin();
    }
    
    if (!text) {
      console.error('Erro: Nenhum texto fornecido');
      console.log('Uso: gicli encrypt <texto> ou echo "texto" | gicli encrypt');
      process.exit(1);
    }
    
    let result;
    if (command === 'encrypt') {
      result = environmentService.encrypt(text);
      console.log(result);
    } else if (command === 'decrypt') {
      result = environmentService.decrypt(text);
      console.log(result);
    }
    
  } catch (error) {
    console.error(`Erro ao ${command === 'encrypt' ? 'criptografar' : 'descriptografar'}:`, error.message);
    process.exit(1);
  }
}

/**
 * Lida com comando generate-config
 * @param {string[]} args - Argumentos do comando
 */
async function handleGenerateConfigCommand(args) {
  try {
    // Parse argumentos
    let swaggerFile = null;
    let outputFile = null;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      switch (arg) {
        case '--swagger':
          swaggerFile = args[++i];
          break;
        case '-o':
        case '--output':
          outputFile = args[++i];
          break;
        case '--help':
        case '-h':
          console.log('Uso: gicli generate-config --swagger <arquivo> --output <arquivo>');
          console.log('');
          console.log('Opções:');
          console.log('  --swagger <arquivo>    Arquivo Swagger/OpenAPI de entrada');
          console.log('  -o, --output <arquivo> Arquivo de configuração de saída');
          console.log('  -h, --help            Exibe esta ajuda');
          console.log('');
          console.log('Exemplo:');
          console.log('  gicli generate-config --swagger docs/starsoft/swagger.json --output starsoft-generated.json');
          process.exit(0);
          break;
        default:
          console.error(`Argumento desconhecido: ${arg}`);
          console.log('Use --help para ver as opções disponíveis');
          process.exit(1);
      }
    }

    // Validar argumentos obrigatórios
    if (!swaggerFile) {
      console.error('Erro: Arquivo swagger é obrigatório');
      console.log('Uso: gicli generate-config --swagger <arquivo> --output <arquivo>');
      process.exit(1);
    }

    if (!outputFile) {
      // Gerar nome de arquivo de saída automaticamente
      const swaggerName = swaggerFile.split('/').pop().split('\\').pop().replace('.json', '');
      outputFile = `${swaggerName}-generated.json`;
    }

    // Gerar configuração
    await swaggerGeneratorService.generateConfigFromFile(swaggerFile, outputFile);

  } catch (error) {
    console.error('❌ Erro ao gerar configuração:', error.message);
    process.exit(1);
  }
}

/**
 * Lê texto do stdin
 * @returns {Promise<string>} Texto lido
 */
function readFromStdin() {
  return new Promise((resolve) => {
    let data = '';
    let timeout = setTimeout(() => {
      resolve(''); // Timeout para evitar hanging
    }, 1000);
    
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      clearTimeout(timeout);
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timeout);
      resolve(data.trim());
    });
    process.stdin.on('error', () => {
      clearTimeout(timeout);
      resolve('');
    });
  });
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

      // Aplica substituição de variáveis de ambiente na connection_string
      const connectionStringSubstituted = environmentService.substitute(connectionString, originConfig.name);

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
(async () => {
let mode = null;
let jobName = null;
let importConfigs = false;
let validateOnly = false;
let verbose = false;
let silent = false;
let configDir = null;
let configFile = null;
let payloadFile = null;
let paramsFile = null;
let outputResponseParams = false;
let listType = null;
let listOrigin = null;

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
      await showHelp();
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
    case '--list':
      listType = args[++i];
      listOrigin = args[++i];
      break;
    case '--payload-file':
      payloadFile = args[++i];
      break;
    case '--params-file':
      paramsFile = args[++i];
      break;
    case '--output-response-params':
      outputResponseParams = true;
      break;
  }
}

if (args.length === 0) {
  await showHelp();
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
} else if (listType && listOrigin) {
  try {
    await importService.loadConfigurations(false, configDir, configFile);
    let jobList;
    if (listType === 'names') {
      jobList = importService.listJobNamesByOrigin(listOrigin);
    } else if (listType === 'ids') {
      jobList = importService.listJobIdsByOrigin(listOrigin);
    } else {
      console.error(`Tipo inválido: ${listType}. Use 'names' ou 'ids'.`);
      process.exit(1);
    }
    if (jobList.length === 0) {
      console.log(`Nenhum job encontrado para a origem '${listOrigin}'.`);
    } else {
      console.log(`Jobs da origem '${listOrigin}':`);
      jobList.forEach(job => console.log(`  - ${job}`));
    }
    process.exit(0);
  } catch (error) {
    console.error('Erro ao listar jobs:', error.message);
    process.exit(1);
  }
} else if (mode && jobName) {
  // Execute job com sistema de dependências
  try {
    // Carrega configurações
    await importService.loadConfigurations(false, configDir, configFile);

    // Obtém todas as origens da configuração carregada
    const allOrigins = [];
    for (const [groupName, config] of importService.configs) {
      if (config.origins) {
        allOrigins.push(...config.origins);
      }
    }

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


      // Aplica template variables e substituições de ambiente
      let processedJobConfig = environmentService.substituteDeep(jobConfig, originConfig.name, jobResults);

      // Se payload file foi especificado, ler e injetar no payload
      if (payloadFile) {
        try {
          const payloadContent = readFileSync(payloadFile, 'utf-8');
          processedJobConfig.payload = JSON.parse(payloadContent);
          if (!silent) {
            console.log(`Payload dinâmico carregado de: ${payloadFile}`);
          }
        } catch (error) {
          throw new Error(`Erro ao ler payload file '${payloadFile}': ${error.message}`);
        }
      }

      // Se params file foi especificado, ler e injetar nos params
      if (paramsFile) {
        try {
          const paramsContent = readFileSync(paramsFile, 'utf-8');
          processedJobConfig.params = JSON.parse(paramsContent);
          if (!silent) {
            console.log(`Parâmetros dinâmicos carregados de: ${paramsFile}`);
          }
        } catch (error) {
          throw new Error(`Erro ao ler params file '${paramsFile}': ${error.message}`);
        }
      }

      loggerService.jobStart(jobId, { origin: originConfig.name, mode });

      let result = null;
      try {
        // Executa o job
        result = await executionService.executeJob(originConfig, processedJobConfig, mode, silent, allOrigins);

        if (result.success) {
          // Armazena resultado na sessão para uso por jobs dependentes
          const sessionKey = `job_result_${jobId}`;
          if (result.type === 'auth') {
            // Para jobs de auth, armazena apenas o status de autenticação
            sessionService.set(sessionKey, {
              authenticated: result.authenticated,
              timestamp: new Date().toISOString()
            }, 3600000); // 1 hora de TTL
          } else {
            // Para jobs de request, armazena os dados da resposta
            sessionService.set(sessionKey, {
              data: result.response.data,
              headers: result.response.headers,
              status: result.response.status,
              timestamp: result.response.timestamp
            }, 3600000); // 1 hora de TTL
          }

          // Também armazena em jobResults para template resolution
          if (result.type === 'auth') {
            jobResults[jobId] = {
              authenticated: result.authenticated,
              timestamp: new Date().toISOString()
            };
          } else {
            jobResults[jobId] = {
              data: result.response.data,
              headers: result.response.headers,
              status: result.response.status,
              timestamp: result.response.timestamp
            };
          }

          if (!silent) {
            console.log(`Job '${jobId}' executado com sucesso`);
          }

          // Processa saída se configurado (apenas para jobs de request)
          let outputResult = null;
          if (result.type !== 'auth') {
            outputResult = await processJobOutput(processedJobConfig, result, originConfig, mode, silent);
          }

          // Se for modo teste E não silencioso, mostra resultado
          if (mode === 'test' && !silent) {
            const resultToShow = { ...result };
            if (outputResult) {
              resultToShow.output = outputResult;
            }
            console.log(`Resultado de ${jobId}:`, JSON.stringify(resultToShow, null, 2));
          }

          // Se --output-response-params foi especificado, salva resposta da API
          if (outputResponseParams && result.type !== 'auth') {
            try {
              // Extrair metadados da resposta da API antes de salvar
              let responseToSave = { ...result.response };
              
              // Se o campo data contém dados da API (objeto), extrair metadados
              if (responseToSave.data && typeof responseToSave.data === 'object') {
                try {
                  const apiData = responseToSave.data;
                  
                  // Adicionar metadados da API no nível superior
                  responseToSave = {
                    ...responseToSave,
                    currentPage: apiData.currentPage,
                    totalPages: apiData.totalPages,
                    pageSize: apiData.pageSize,
                    totalCount: apiData.totalCount,
                    hasPrevious: apiData.hasPrevious,
                    hasNext: apiData.hasNext,
                    succeeded: apiData.succeeded,
                    errors: apiData.errors,
                    message: apiData.message
                  };
                } catch (parseError) {
                  // Se não conseguir extrair, manter estrutura original
                  console.warn(`Aviso: Não foi possível extrair metadados da resposta da API: ${parseError.message}`);
                }
              }
              
              // Agora remover o campo "data" que contém os registros
              if (responseToSave.data) {
                responseToSave.data = "[REMOVIDO - CAMPO DE DADOS]";
              }
              
              // Salva sempre no arquivo "output-response-params.js"
              const outputFilePath = './output-response-params.js';
              const fs = await import('fs');
              fs.writeFileSync(outputFilePath, JSON.stringify(responseToSave, null, 2), 'utf8');
              
              if (!silent) {
                console.log(`Resposta da API salva em: ${outputFilePath}`);
              }
            } catch (saveError) {
              console.warn(`Aviso: Não foi possível salvar resposta da API: ${saveError.message}`);
            }
          }

        } else {
          throw new Error(`Falha no job ${jobId}: ${result.error}`);
        }
      } finally {
        // Limpa contexto de logging (sempre executado, mesmo em caso de erro)
        loggerService.jobEnd(jobId, result?.success || false);
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
  await showHelp();
  process.exit(1);
}
})();