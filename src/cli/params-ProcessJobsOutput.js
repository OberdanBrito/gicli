import environmentService from '../services/environment/index.js';
import fileOutputService from '../services/file-output/index.js';
import transportService from '../services/transport/index.js';
import handleCryptCommand from "./params-Crypt.js";
import handleGenerateConfigCommand from "./params-CreateConfig.js";
import VersionService from "../services/version/VersionService.js";


/**
 * Processa saída de falha para banco de dados
 * @param {object} jobConfig - Configuração do job
 * @param {Error|string} error - Erro ocorrido
 * @param {string} itemId - ID do item processado
 * @param {object} originConfig - Configuração da origem
 * @param {string} mode - Modo de execução
 */
async function processFailureOutput(jobConfig, error, itemId, originConfig, mode) {
    if (!jobConfig.output?.enabled || !jobConfig.output.save_failures) {
        return;
    }

    console.log('Processando saída de falha para banco de dados...');
    console.log('Error:', error);
    console.log('ItemId:', itemId);

    // Se error é um objeto result (com response), extrai a mensagem de lá
    let errorMessage;
    let responseData = null;

    if (error && error.response) {
        // É um objeto result
        errorMessage = error.response.data?.message || `HTTP ${error.response.status}`;
        responseData = error.response.data;
    } else {
        // É um erro ou string
        errorMessage = error instanceof Error ? error.message : error;
    }

    // Criar objeto de resultado de falha
    const failureResult = {
        success: "0", // Alterado para string para evitar conflito de tipos
        error: errorMessage,
        response: {
            data: {
                success: "0", // Alterado para string para evitar conflito de tipos
                message: errorMessage,
                data: responseData, // Usa os dados extraídos
                job_id: itemId,
                timestamp: new Date().toISOString(),
                origin: originConfig.name
            }
        }
    };

    // Usar a mesma lógica de processamento de output normal
    await processJobOutput(jobConfig, failureResult, originConfig, mode, true);
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
    } catch (error) {
        console.warn(`Aviso: Falha ao processar saída para job ${jobConfig.id}:`, error.message);
        return { success: false, error: error.message };
    }
}

export { processJobOutput, processFailureOutput };