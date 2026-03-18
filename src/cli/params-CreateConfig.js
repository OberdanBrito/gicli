import swaggerGeneratorService from '../services/swagger-generator/index.js';

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

export default handleGenerateConfigCommand;
