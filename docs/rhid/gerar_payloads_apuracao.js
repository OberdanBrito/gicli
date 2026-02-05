#!/usr/bin/node

import sql from 'mssql';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Suprimir dicas do dotenv
process.env.DOTENV_CONFIG_DISABLE_TIPS = 'true';

const config = {
  server: '192.168.10.3',
  port: 10252,
  user: 'oberdan.brito',
  password: 'qe446pnh@',
  database: 'GSINTEGRACOES',
  options: { trustServerCertificate: true, encrypt: false }
};

const gicliPath = 'gicli'; // Assumindo que está no PATH, ajuste se necessário

async function run() {
  try {
    const pool = await sql.connect(config);
    const result = await pool.request().query('SELECT id FROM dbo.RHiDPessoas');
    const ids = result.recordset.map(row => row.id);

    console.log(`Encontrados ${ids.length} IDs de colaboradores.`);

    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) {
      chunks.push(ids.slice(i, i + 50));
    }

    console.log(`Divididos em ${chunks.length} lotes de até 50 IDs.`);

    for (let index = 0; index < chunks.length; index++) {
      const payload = {
        idPerson: chunks[index],
        ini: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // YYYYMMDD de hoje
        fim: new Date().toISOString().slice(0, 10).replace(/-/g, ''), // Ajuste se precisar de range
        afdChanges: [],
        alertId: [],
        pagina: 0
      };

      const fileName = path.join(__dirname, `payload_lote${index + 1}.json`);
      fs.writeFileSync(fileName, JSON.stringify(payload));

      console.log(`Arquivo gerado: ${fileName}`);
      console.log(`Conteúdo: ${JSON.stringify(payload, null, 2)}\n`);

      // Comente essa linha para teste (apenas gerar arquivos)
      execSync(`${gicliPath} -p -j rhid_apuracao_ponto --payload-file ${fileName}`, { stdio: 'inherit' });
    }

    await pool.close();
    console.log('Processo concluído.');
  } catch (error) {
    console.error('Erro:', error.message);
  }
}

run();
