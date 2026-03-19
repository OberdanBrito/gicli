#!/usr/bin/env node
// noinspection SpellCheckingInspection

import { readFileSync } from 'fs';
import importService from '../services/import/index.js';
import environmentService from '../services/environment/index.js';
import executionService from '../services/execution/index.js';
import sessionService from '../services/session/index.js';
import { DependencyResolver } from '../services/dependency-resolver/index.js';
import VersionService from '../services/version/VersionService.js';
import loggerService from '../services/logger/index.js';
import { getHelpText } from './help-template.js';
import packageInfo from '../../package.json' with { type: 'json' };
import paramsListJobs from './params-ListJobs.js';
import handleCryptCommand from './params-Crypt.js';
import handleGenerateConfigCommand from "./params-CreateConfig.js";
import { processJobOutput, processFailureOutput } from "./params-ProcessJobsOutput.js";


// Parse arguments
const args = process.argv.slice(2);

/**
 * Exibe o texto de ajuda da CLI
 */
async function showHelp() {
  console.log(getHelpText(packageInfo));
}

// Parse arguments
(async () => {
let mode = null;
let jobName = null;
let importConfigs = false;
let validateOnly = false;
let silent = false;
let configDir = null;
let configFile = null;
let payloadFile = null;
let paramsFile = null;
let outputResponseParams = false;
let listType = null;
let listOrigin = null;

// Tratar comandos diretos (não começam com -)
if (args.length > 0 && !args[0].startsWith('-')) {
  const command = args[0];
  
  if (command === 'encrypt' || command === 'decrypt') {
    await handleCryptCommand(command, args[1]);
    process.exit(0);
  } else if (command === 'generate-config') {
    await handleGenerateConfigCommand(args.slice(1));
    process.exit(0);
  } else {
    console.error(`Comando desconhecido: ${command}`);
    await showHelp();
    process.exit(1);
  }
}

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
    case '--version':
      const versionService = new VersionService();
      console.log(`Versão: ${versionService.getVersion()}`);
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
  await paramsListJobs(listType, listOrigin);
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

      // Se params file foi especificado, ler e injetar nos params ou payload
      if (paramsFile) {
        try {
          const paramsContent = readFileSync(paramsFile, 'utf-8');
          const paramsData = JSON.parse(paramsContent);
          if (processedJobConfig.method === 'POST') {
            processedJobConfig.payload = paramsData;
          } else {
            processedJobConfig.params = paramsData;
          }
          if (!silent) {
            console.log(`Parâmetros dinâmicos carregados de: ${paramsFile}`);
          }
        } catch (error) {
          throw new Error(`Erro ao ler params file '${paramsFile}': ${error.message}`);
        }
      }

      // Verificar se é processamento em lote
      const batchConfig = processedJobConfig.batch_processing;
      const isBatchProcessing = batchConfig && (batchConfig === true || (typeof batchConfig === 'object' && Array.isArray(processedJobConfig.payload)));
      const groupPayload = batchConfig && typeof batchConfig === 'object' && batchConfig.group_payload === true;

      if (isBatchProcessing) {
        if (groupPayload) {
          // Envia o array inteiro como payload em uma única requisição
          if (!silent) {
            console.log(`Processamento em lote agrupado: ${processedJobConfig.payload.length} itens em uma única requisição`);
          }

          loggerService.jobStart(jobId, { origin: originConfig.name, mode });
          const result = await executionService.executeJob(originConfig, processedJobConfig, mode, silent, allOrigins);

          if (result.success) {
            const sessionKey = `job_result_${jobId}`;
            if (result.type === 'auth') {
              sessionService.set(sessionKey, {
                authenticated: result.authenticated,
                timestamp: new Date().toISOString()
              }, 3600000);
              jobResults[jobId] = { authenticated: result.authenticated, timestamp: new Date().toISOString() };
            } else {
              sessionService.set(sessionKey, {
                data: result.response.data,
                headers: result.response.headers,
                status: result.response.status,
                timestamp: result.response.timestamp
              }, 3600000);
              jobResults[jobId] = {
                data: result.response.data,
                headers: result.response.headers,
                status: result.response.status,
                timestamp: result.response.timestamp
              };
            }

            if (result.type !== 'auth') {
              if (result.response && result.response.status === 400 && processedJobConfig.output && processedJobConfig.output.save_failures && processedJobConfig.output.type === 'database') {
                await processFailureOutput(processedJobConfig, result, jobId, originConfig, mode);
              } else {
                await processJobOutput(processedJobConfig, result, originConfig, mode, silent);
              }
            }

            if (!silent) {
              console.log(`✓ Job '${jobId}' processado com sucesso (array agrupado)`);
            }
          } else {
            throw new Error(`Falha no job ${jobId}: ${result.error}`);
          }

        } else {
          // Itera sobre cada item e executa uma requisição por item
          if (!silent) {
            console.log(`Processamento em lote iterativo: ${processedJobConfig.payload.length} itens`);
          }

          let totalProcessed = 0;
          let totalErrors = 0;

          for (let i = 0; i < processedJobConfig.payload.length; i++) {
            const item = processedJobConfig.payload[i];
            const itemId = item.registro || item.id || `item_${i + 1}`;

            if (!silent) {
              console.log(`Processando item ${i + 1}/${processedJobConfig.payload.length}: ${itemId}`);
            }

            const itemJobConfig = {
              ...processedJobConfig,
              payload: item
            };

            try {
              const result = await executionService.executeJob(originConfig, itemJobConfig, mode, silent, allOrigins);

              if (result.success) {
                const sessionKey = `job_result_${jobId}_${itemId}`;
                if (result.type === 'auth') {
                  sessionService.set(sessionKey, {
                    authenticated: result.authenticated,
                    timestamp: new Date().toISOString(),
                    itemId: itemId
                  }, 3600000);
                  jobResults[`${jobId}_${itemId}`] = {
                    authenticated: result.authenticated,
                    timestamp: new Date().toISOString(),
                    itemId: itemId
                  };
                } else {
                  sessionService.set(sessionKey, {
                    data: result.response.data,
                    headers: result.response.headers,
                    status: result.response.status,
                    timestamp: result.response.timestamp,
                    itemId: itemId
                  }, 3600000);
                  jobResults[`${jobId}_${itemId}`] = {
                    data: result.response.data,
                    headers: result.response.headers,
                    status: result.response.status,
                    timestamp: result.response.timestamp,
                    itemId: itemId
                  };
                }

                if (result.type !== 'auth') {
                  if (result.response && result.response.status === 400 && itemJobConfig.output && itemJobConfig.output.save_failures && itemJobConfig.output.type === 'database') {
                    await processFailureOutput(itemJobConfig, result, itemId, originConfig, mode);
                  } else {
                    await processJobOutput(itemJobConfig, result, originConfig, mode, silent);
                  }
                }

                totalProcessed++;
                if (!silent) {
                  console.log(`✓ Item ${itemId} processado com sucesso`);
                }
              } else {
                totalErrors++;
                console.error(`✗ Falha no processamento do item ${itemId}: ${result.error}`);

                if (itemJobConfig.output && itemJobConfig.output.save_failures && itemJobConfig.output.type === 'database') {
                  try {
                    await processFailureOutput(itemJobConfig, result.error, itemId, originConfig, mode);
                  } catch (saveError) {
                    console.warn(`Aviso: Falha ao salvar erro no banco: ${saveError.message}`);
                  }
                }
              }
            } catch (error) {
              totalErrors++;
              console.error(`✗ Erro ao processar item ${itemId}: ${error.message}`);

              if (itemJobConfig.output && itemJobConfig.output.save_failures && itemJobConfig.output.type === 'database') {
                try {
                  await processFailureOutput(itemJobConfig, error, itemId, originConfig, mode);
                } catch (saveError) {
                  console.warn(`Aviso: Falha ao salvar erro no banco: ${saveError.message}`);
                }
              }
            }
          }

          if (!silent) {
            console.log(`\nProcessamento em lote concluído:`);
            console.log(`  ✓ Sucessos: ${totalProcessed}`);
            console.log(`  ✗ Erros: ${totalErrors}`);
          }

          if (totalProcessed === 0) {
            throw new Error(`Falha no processamento em lote: nenhum item foi processado com sucesso`);
          }
        }

      } else {
        // Processamento normal (único item)
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
              // Se status 400 e save_failures ativo, salva como falha
              if (result.response && result.response.status === 400 && processedJobConfig.output && processedJobConfig.output.save_failures && processedJobConfig.output.type === 'database') {
                outputResult = await processFailureOutput(processedJobConfig, result, jobId, originConfig, mode);
              } else {
                outputResult = await processJobOutput(processedJobConfig, result, originConfig, mode, silent);
              }
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
        } catch (error) {
          // Salvar falha no banco de dados se save_failures estiver habilitado (para processamento normal)
          if (processedJobConfig.output && processedJobConfig.output.save_failures && processedJobConfig.output.type === 'database') {
            try {
              await processFailureOutput(processedJobConfig, error, jobId, originConfig, mode);
            } catch (saveError) {
              console.warn(`Aviso: Falha ao salvar erro no banco: ${saveError.message}`);
            }
          }
          
          throw error;
        } finally {
          // Limpa contexto de logging (sempre executado, mesmo em caso de erro)
          loggerService.jobEnd(jobId, result?.success || false);
        }
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
