import importService from '../services/import/index.js';

/**
 * Lista jobs de uma origem
 * @param {string} tipo - 'names' ou 'ids'
 * @param {string} origem - Nome da origem
 */
async function paramsListJobs(tipo, origem) {
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

export default paramsListJobs;