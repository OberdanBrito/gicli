# Gestor de Integrações (GI) CLI

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

Uma ferramenta de linha de comando poderosa para executar integrações com APIs REST e WebServices SOAP de forma dinâmica, reutilizável e automatizada. Inspirada no Postman e Kong, mas focada em CLI + automação + persistência de dados.

## 🎯 O que é o GI CLI?

O **Gestor de Integrações (GI)** é uma ferramenta CLI que permite:

- **Executar requisições HTTP/REST** de forma programática e reutilizável
- **Gerenciar autenticação automática** com renovação de tokens
- **Processar respostas** e salvar dados em arquivos ou bancos de dados
- **Resolver dependências** entre jobs de integração
- **Automatizar integrações** via agendadores (como cron) em produção

Ideal para cenários onde você precisa integrar sistemas externos de forma confiável e escalável, sem depender de interfaces gráficas.

### Essência da Atividade

A ferramenta transforma arquivos JSON de configuração em execuções reais de APIs, permitindo:
- **Configuração declarativa**: Defina endpoints, autenticação e outputs em JSON
- **Execução automatizada**: Rode jobs de integração via linha de comando
- **Persistência inteligente**: Salve resultados em arquivos ou bancos (SQLite/SQL Server)
- **Dependências entre jobs**: Execute sequências complexas de requisições

## 🚀 Instalação

### Via npm

```bash
npm install @tecnologiagruposrm/gicli
```

**Nota**: O pacote é público no npm e pode ser instalado diretamente sem autenticação.

## 📖 Uso Básico

### Comandos Principais

```bash
# Executar job em modo produção
gicli -p -j <nome_do_job>

# Executar job em modo teste (com logs detalhados)
gicli -t -j <nome_do_job>

# Importar e validar configurações (pasta padrão: docs/)
gicli -i

# Importar configurações de uma pasta específica
gicli -i -d /caminho/para/configs

# Importar arquivo específico
gicli -i -f /caminho/para/configs/rhid.json

# Para import em produção (salva em /etc/gicli):
sudo gicli -i -d /caminho/para/configs

# Validar configurações sem executar
gicli -v

# Ver ajuda
gicli --help
```

### Modo Produção vs Teste

- **Produção (-p)**: Execução silenciosa, ideal para agendadores (cron)
- **Teste (-t)**: Logs detalhados, útil para debugging

## ⚙️ Estrutura de Configuração

As configurações são definidas em arquivos JSON separados por origem de dados. Por padrão, o GI procura por arquivos na pasta `docs/`, mas você pode especificar um diretório diferente usando a opção `-d` (ex.: `gicli -i -d ~/minhas-configs`) ou um arquivo específico com `-f` (ex.: `gicli -i -f ~/minhas-configs/rhid.json`).

**Em produção**, as configurações validadas são salvas em `/etc/gicli` (requer permissões sudo). Isso permite que múltiplos usuários acessem as configurações validadas do sistema.

Cada arquivo descreve:

- **Grupo**: Nome do conjunto de integrações
- **Origens**: Fontes de dados (APIs) com jobs associados

### Exemplo de Arquivo JSON

```json
{
  "group": "MinhaEmpresa",
  "origins": [
    {
      "name": "api_externa",
      "base_url": "https://api.exemplo.com",
      "job": [
        {
          "id": "login",
          "type": "auth",
          "mode": "production",
          "name": "Autenticação",
          "method": "POST",
          "path": "/auth/login",
          "payload": {
            "username": "$ENV_USERNAME",
            "password": "$ENV_PASSWORD"
          },
          "session_name": "SESSION_TOKEN",
          "token_identifier": "access_token",
          "token_expiration_time": 3600
        },
        {
          "id": "buscar_dados",
          "type": "request",
          "mode": "production",
          "name": "Buscar Dados",
          "method": "GET",
          "path": "/data",
          "dependencies": ["login"],
          "output": {
            "enabled": true,
            "type": "database",
            "driver": "sqlite",
            "connection_string": "data.db",
            "table": "dados_api"
          }
        }
      ]
    }
  ]
}
```

### Campos Principais

- **type**: `"auth"` (autenticação) ou `"request"` (requisição normal)
- **dependencies**: Lista de jobs que devem executar antes
- **output**: Configuração de salvamento (arquivo ou banco)
- **Variáveis**: `$ENV_*` (ambiente), `$SESSION_*` (tokens), `{{job_id.field}}` (dependências)

### Validação

O GI valida automaticamente as configurações contra um schema JSON. Use `gicli -v` para validar sem executar.

## 🔧 Arquitetura e Serviços

O GI é construído em módulos independentes (princípio de responsabilidade única):

- **auth**: Gerenciamento de autenticação e tokens
- **execution**: Execução de requisições HTTP
- **import**: Carregamento e validação de configurações
- **validator**: Validação JSON contra schema
- **transport**: Persistência em bancos de dados
- **session**: Gerenciamento de estado temporário
- **logger**: Registro de eventos

## 🛠️ Desenvolvimento e Contribuição

### Como Contribuir

1. **Fork** o repositório
2. **Clone** sua fork: `git clone https://github.com/seu-usuario/gicli.git`
3. **Instale dependências**: `bun install`
4. **Crie uma branch**: `git checkout -b feature/nova-funcionalidade`
5. **Desenvolva** e teste suas mudanças
6. **Commit**: `git commit -m "Adiciona nova funcionalidade"`
7. **Push**: `git push origin feature/nova-funcionalidade`
8. **Abra um Pull Request**

### Estrutura do Projeto

```
gicli/
├── src/
│   ├── cli/               # Entrypoint da CLI
│   ├── services/          # Serviços modulares
│   │   ├── auth/          # Autenticação
│   │   ├── execution/     # Execução de jobs
│   │   ├── validator/     # Validação JSON
│   │   └── ...
│   └── config/            # Schemas e exemplos (não incluído no pacote)
├── tests/                 # Testes
├── docs/                  # Documentação adicional
├── .gitignore             # Arquivos ignorados no Git
├── .npmignore             # Arquivos excluídos do npm
├── package.json
└── README.md
```

### Diretrizes de Desenvolvimento

- **Linguagem**: JavaScript (ES6+)
- **Runtime**: Bun (preferido) ou Node.js
- **Testes**: Execute `bun test` antes de commits
- **Commits**: Use mensagens descritivas em português
- **Issues**: Abra issues para bugs ou sugestões de features

### Funcionalidades Planejadas

- [x] Sistema de dependências entre jobs
- [x] Autenticação automática com retry
- [x] Persistência em SQLite e SQL Server
- [ ] Suporte a WebServices SOAP
- [ ] Interface web para configuração visual
- [ ] Plugins customizados

## 📄 Licença

Este projeto está licenciado sob a [ISC License](LICENSE) - veja o arquivo LICENSE para detalhes.

## 🤝 Suporte

- **Issues**: [GitHub Issues](https://github.com/oberdanbrito/gicli/issues)
- **Documentação**: Consulte o arquivo `review.md` em `.windsurf/workflows/` para detalhes técnicos
- **Autor**: Oberdan Brito <oberdanbdj@gmail.com>

---

**GI CLI** - Transformando integrações em código reutilizável e automatizado.
