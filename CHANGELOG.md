# Changelog

## [0.5.28] - 2026-03-19

### 🔧 Refactoring
- **Modo Silencioso no HTTP Client**: Implementado suporte completo ao modo silencioso no HttpClientService
  - Adicionada propriedade `silent` e método `setSilent()`
  - Logs de requisições HTTP, retries e erros agora respeitam o modo silencioso
  - Token de autorização é mascarado nos logs apenas quando não está em modo silencioso

### 🐛 Bug Fixes
- **Logs HTTP em Modo Silencioso**: Corrigido problema onde logs de requisições HTTP não respeitavam o parâmetro `-s/--silent`
- **Propagação do Modo Silencioso**: Implementada propagação completa através de ExecutionService e AuthService

### 📝 Technical Changes
- HttpClientService agora segue o mesmo padrão de outros serviços com propriedade `silent`
- AuthService e ExecutionService propagam configuração silent para HTTP client
- Logs de autenticação e renovação de token também respeitam modo silencioso

## [0.5.27] - 2026-03-19

### 🐛 Bug Fixes
- **Logs em Modo Silencioso**: Corrigido problema onde logs de inserção no SQL Server não respeitavam o parâmetro `-s/--silent`
- **Propagação do Modo Silencioso**: Implementada propagação automática da configuração silent quando novos drivers são criados

### 📝 Technical Changes
- Publicada versão 0.5.27 no npm registry

## [0.5.26] - 2026-03-19

### 🔧 Refactoring
- **Modo Silencioso Otimizado**: Refatorada implementação do parâmetro `-s/--silent` para usar propriedades de classe em vez de passagem de parâmetros
  - `SQLServerDriver`: Adicionada propriedade `silent` e método `setSilent()`
  - `TransportService`: Adicionada propriedade `silent` com propagação automática para drivers
  - Removido parâmetro `silent` das assinaturas de todos os métodos
  - Logs do banco de dados agora respeitam o modo silencioso em todos os níveis

### 🐛 Bug Fixes
- **Logs em Modo Silencioso**: Corrigido problema onde logs de inserção no SQL Server não respeitavam o parâmetro `-s/--silent`
- **Propagação do Modo Silencioso**: Implementada propagação automática da configuração silent quando novos drivers são criados

### 📝 Technical Changes
- Código mais limpo e orientado a objetos sem inflar assinaturas de métodos
- Padrão consistente com `loggerService.setSilent()` já existente
- Melhor performance ao evitar passagem contínua do parâmetro pela cadeia de chamadas

## [0.5.25] - 2026-03-18

### 🔧 Refactoring
- **Modularização da CLI**: Movidas funções para módulos separados para melhor organização do código
  - `listJobs` → `params-ListJobs.js`
  - `handleCryptCommand` → `params-Crypt.js`
  - `handleGenerateConfigCommand` → `params-CreateConfig.js`
  - `processJobOutput` e `processFailureOutput` → `params-ProcessJobsOutput.js`
- **Limpeza de Imports**: Removidos imports não utilizados do arquivo principal (`index.js`)
- **Scripts npm**: Adicionados scripts `listar-jobs` e `encrypt` para facilitar execuções comuns

### ✨ New Features
- **baseService**: Módulo base para serviços com funcionalidades comuns
- **VersionService**: Serviço para gerenciamento de versão da aplicação

### 📝 Technical Changes
- Estrutura de arquivos reorganizada para melhor manutenibilidade
- Código mais limpo e modular no arquivo principal da CLI
- Mantida compatibilidade 100% com funcionalidades existentes

## [0.3.8] - 2026-03-13

### 🐛 Bug Fixes
- **Conflito de Tipos no SQL Server**: Corrigido erro "Operand type clash: int is incompatible with text" ao inserir dados de falha na tabela ServiceLayerRFPPreAdmitirResultados
- **Campo Success como String**: Alterado o campo `success` no objeto de falha de boolean/inteiro para string ("0") para compatibilidade com coluna TEXT
- **Processamento de Saída de Falha**: Ajustado a função `processFailureOutput` para garantir consistência de tipos

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
