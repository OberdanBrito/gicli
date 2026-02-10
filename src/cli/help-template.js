/**
 * Template de ajuda do gicli
 * @param {object} packageInfo - Informações do package.json
 * @returns {string} Texto de ajuda formatado
 */
export function getHelpText(packageInfo) {
  return `Uso: gicli [OPÇÃO]...
gicli v${packageInfo.version} - Gestor de integrações.

Comandos:
  encrypt <texto>      Criptografa um texto para uso em arquivos de configuração
  decrypt <texto>      Descriptografa um texto criptografado
  generate-config      Gera configuração a partir de arquivo Swagger/OpenAPI
  list                 Lista os jobs cadastrados de acordo a origem e o tipo (names ou ids)

Argumentos disponíveis:
  -p, --production     Executa o job em modo produção
  -t, --test           Executa o job em modo teste
  -j, --job            Nome do job a ser executado
  -i, --import         Importa e valida configurações
  -v, --validate       Valida configurações sem executar jobs
  -d, --dir            Diretório de configurações (padrão: docs/)
  -f, --file           Arquivo de configuração específico
  -s, --silent         Reduz as mensagens de saída na tela
  --payload-file       Arquivo JSON com payload dinâmico para a requisição
  --params-file        Arquivo JSON com parâmetros dinâmicos para a requisição
  --output-response-params  Salva metadados da resposta da API em output-response-params.js
  -h, --help           Exibe esta mensagem de ajuda

Variáveis de Substituição:
  $DATE                Substituído pela data corrente no formato YYYY-MM-DD
  $ENV_VARIÁVEL        Substituído pelo valor da variável de ambiente
  $SESSION_NOME        Substituído pelo valor da sessão armazenada

`;
}
