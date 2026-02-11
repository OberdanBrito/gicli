#!/usr/bin/node

import sql from 'mssql';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gicliPath = 'node ./src/cli/index.js';
const outputFilePath = './output-response-params.js';

const config = {
  server: '192.168.10.3',
  port: 10252,
  user: 'oberdan.brito',
  password: 'qe446pnh@',
  database: 'GSINTEGRACOES',
  options: { trustServerCertificate: true, encrypt: false }
};


async function run() {

    const pool = await sql.connect(config);
    await pool.request().query('TRUNCATE TABLE GSINTEGRACOES.dbo.ServiceLayerRFPColaboradores;');

  let currentPage = 1;
  let totalProcessed = 0;

  console.log('Iniciando processamento dinâmico de colaboradores v2.0');
  console.log('Usando nova funcionalidade --output-response-params para monitoramento\n');

  while (true) {
    console.log(`Processando página ${currentPage}...`);

    // Criar arquivo de parâmetros temporário
    const paramsFileName = path.join(__dirname, `../../params_page_${currentPage}.json`);
    const params = {
      page: currentPage,
      pageSize: 4000,
      referencia: '$DATE',
      tenId: '986648654D50398B2942C892BBBD94EF59DAFD853C37A70F393D63D511A284E3'
    };

    fs.writeFileSync(paramsFileName, JSON.stringify(params, null, 2));

    try {
      // Executar gicli com --output-response-params
      const command = `${gicliPath} -p -j get_api_v1_ConsultasPaginadas_listar_colaboradores --params-file ${paramsFileName} --output-response-params`;

      execSync(command, {
        encoding: 'utf8',
        cwd: path.resolve(__dirname, '../../../gicli'),
        stdio: 'inherit'
      });

      // Ler resposta da API do arquivo gerado
      if (fs.existsSync(outputFilePath)) {
        const responseContent = fs.readFileSync(outputFilePath, 'utf8');
        const responseData = JSON.parse(responseContent);

        console.log(` Página ${currentPage} processada`);
        console.log(`    hasNext: ${responseData.hasNext}`);
        console.log(`    succeeded: ${responseData.succeeded}`);
        console.log(`    totalCount: ${responseData.totalCount || 'N/A'}`);
        console.log(`    currentPage: ${responseData.currentPage || 'N/A'}`);

        // Verificar se deve continuar
        if (responseData.hasNext === false) {
          console.log(`\nFim da paginação detectado na página ${currentPage}!`);
          console.log(` Total de páginas processadas: ${totalProcessed + 1}`);
          break;
        }

        if (!responseData.succeeded) {
          console.log(`Erro na API da página ${currentPage}: ${responseData.message || 'Erro desconhecido'}`);
          break;
        }

        totalProcessed++;
        currentPage++;

      } else {
        console.log(`Arquivo de resposta não encontrado: ${outputFilePath}`);
        break;
      }

    } catch (error) {
      console.log(`Erro na execução da página ${currentPage}: ${error.message}`);
      break;
    } finally {
      // Limpar arquivo temporário
      try {
        if (fs.existsSync(paramsFileName)) {
          fs.unlinkSync(paramsFileName);
        }
      } catch (cleanupError) {
        // Ignorar erros de limpeza
      }
    }

    // Pequena pausa para evitar sobrecarga
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\nProcessamento concluído com sucesso');
  console.log(`Total de páginas processadas: ${totalProcessed + 1}`);
  console.log(`Última página processada: ${currentPage}`);
}

run().catch(error => {
  console.error('Erro geral:', error.message);
  process.exit(1);
});
