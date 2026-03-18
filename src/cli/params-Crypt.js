import environmentService from '../services/environment/index.js';
import importService from "../services/import/index.js";

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

export default handleCryptCommand;