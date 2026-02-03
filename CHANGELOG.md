# Changelog

## [0.3.7] - 2025-02-03

### 🔒 Security
- **Remover Logs Sensíveis**: Eliminados console.log que exibiam connection strings com senhas em produção
- **Proteção de Credenciais**: Versão segura sem vazamento de informações sensíveis nos logs

### 🐛 Bug Fixes
- **Substituição de Variáveis na Origem**: Corrigido problema onde `$ENV_SQLSERVER_PASSWORD` não era substituído em connection_string do nível da origem
- **Fallback de Connection String**: Implementado substituição de ambiente para connection_string herdada da origem

## [0.3.6] - 2025-02-03

### 🐛 Bug Fixes
- **Connection String Global**: Corrigido erro "Login failed" devido a falta de substituição de variáveis de ambiente em connection_string da origem
- **Substituição de Ambiente**: Adicionado `environmentService.substitute()` para connection_string do nível da origem

### 🔧 Technical Changes
- Implementado fallback: job.connection_string → origin.connection_string
- Adicionados logs temporários para debug (removidos na v0.3.7)

## [0.3.5] - 2025-02-03

### ✨ New Features
- **Connection String Global**: Implementado suporte a connection_string no nível da origem
- **Herança de Configuração**: Jobs herdam connection_string da origem quando não definida individualmente
- **Fallback Inteligente**: Prioriza connection_string do job, depois usa da origem

### 🔧 Technical Changes
- Schema validator atualizado para permitir connection_string na origem
- Transport service implementado com lógica de fallback
- CLI atualizado para passar originConfig e usar lógica de herança
- JSON refatorado: 12 connection_strings duplicadas removidas
- Compatibilidade 100% mantida com configurações existentes

### 📝 Usage
```json
{
  "origins": [
    {
      "name": "rhid",
      "connection_string": "server=...;password=$ENV_SQLSERVER_PASSWORD;...",
      "job": [
        {
          "output": {
            "driver": "sqlserver",
            "table": "MinhaTabela"
            // connection_string herdada da origem
          }
        }
      ]
    }
  ]
}
```

## [0.3.4] - 2025-02-03

### 🐛 Bug Fixes
- **Process Exit**: Adicionado `process.exit(0)` para garantir retorno ao prompt de comando após execução bem-sucedida
- **Processo Pendurado**: Resolvido problema onde CLI não retornava ao prompt após conclusão

## [0.3.3] - 2025-02-03

### ✨ New Features
- **Limpeza de Tabela Antes da Inserção**:
  - Adicionada propriedade `clear_before_insert` na configuração de output para banco de dados
  - Implementado método `clearTable()` no driver SQL Server com fallback TRUNCATE → DELETE
  - Warning de segurança exibido quando a tabela está sendo limpa para evitar perda acidental de dados

### 🐛 Bug Fixes
- **Conexão SQL Server com Endereço IP**: Corrigido erro "Setting the TLS ServerName to an IP address is not permitted"
  - Quando `TrustServerCertificate=true` está definido, `encrypt=false` é aplicado automaticamente
  - Resolve problemas de conexão com bancos de dados usando endereços IP em redes internas

### 🔧 Technical Changes
- Adicionada validação para propriedade `clear_before_insert` no schema JSON
- Implementada lógica de fallback: TRUNCATE (rápido) → DELETE (compatível com foreign keys)
- Adicionado warning visual "⚠️ LIMPANDO TABELA" para alertar sobre perda de dados

### 📝 Usage
```json
"output": {
  "enabled": true,
  "type": "database",
  "driver": "sqlserver",
  "clear_before_insert": true,
  "table": "MinhaTabela"
}
```

## [0.3.1] - 2025-02-03

### 🐛 Bug Fixes
- **Variáveis de Ambiente com Prefixo ENV_**: Corrigido regex que não encontrava variáveis com prefixo ENV_
  - Modificado `environmentService.substitute()` para adicionar prefixo ENV_ de volta durante busca
  - Agora `$ENV_RHID_PASSWORD` busca corretamente por `ENV_RHID_PASSWORD` em process.env

### ⚠️ BREAKING CHANGES
- **Node.js ES6 Modules**: O projeto agora requer Node.js 16+ e usa ES6 modules (`"type": "module"`)
- **SQLite Support**: Suporte a SQLite foi temporariamente removido para compatibilidade com Node.js
- **Runtime**: Mudado de Bun para Node.js como runtime padrão

### ✨ New Features
- **Gerenciamento Automático de Variáveis de Ambiente**:
  - Criação automática da pasta `.gicli` na home do usuário
  - Criação automática do arquivo `.env` se não existir
  - Extração automática de variáveis de ambiente de arquivos JSON (strings que começam com `$`)
  - Adição de variáveis vazias ao `.env` sem sobrescrever existentes
  - Organização de variáveis por grupo com comentários no arquivo `.env`
  - Notificação ao usuário sobre variáveis que precisam ser preenchidas
  - Integração com biblioteca `dotenv` para carregar variáveis no `process.env`

### 🔧 Technical Changes
- Adicionada dependência `dotenv` para gerenciamento de variáveis de ambiente
- Convertido `module.exports` para ES6 `export` em `dependency-resolver/index.js`
- Atualizado shebang de `#!/usr/bin/env bun` para `#!/usr/bin/env node`
- Atualizados scripts no package.json para usar `node` em vez de `bun run`
- Implementado rastreamento de variáveis processadas para evitar notificações duplicadas

### 🐛 Bug Fixes
- Corrigido erro de importação ES6 vs CommonJS no dependency resolver
- Removida dependência de `bun:sqlite` que causava incompatibilidade com Node.js

### 📝 Migration Notes
- **Para usuários existentes**: Após atualizar, execute `gicli -i` para reprocessar suas configurações e criar automaticamente o arquivo `.env` com as variáveis necessárias
- **Requisitos**: Node.js 16+ agora é obrigatório
- **SQLite**: Suporte retornará em versão futura com biblioteca compatível com Node.js

## [0.2.2] - Versões Anteriores
- Funcionamento base com Bun runtime
- Suporte a SQLite via bun:sqlite
- Configurações manuais de ambiente
