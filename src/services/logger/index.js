import { writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, readFileSync, unlinkSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { format } from 'util';
import { homedir } from 'os';

/**
 * Serviço de Logger
 * Gerencia registro de eventos, logs e execução de jobs
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const LOG_LEVEL_NAMES = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR'
};

class LoggerService {
  constructor() {
    this.logLevel = LOG_LEVELS.INFO; // Nível padrão
    this.silent = false; // Modo silencioso para produção
    this.logToFile = true; // Salvar em arquivo
    this.maxLogSize = 10 * 1024 * 1024; // 10MB por arquivo
    this.maxLogFiles = 5; // Máximo de arquivos de log

    // Define diretório de logs com prioridades
    this.logDir = this.determineLogDirectory();

    // Cria diretório de logs se não existir
    if (!existsSync(this.logDir)) {
      try {
        mkdirSync(this.logDir, { recursive: true });
        console.log(`Diretório de logs criado: ${this.logDir}`);
      } catch (error) {
        console.error('Erro ao criar diretório de logs:', error.message);
        this.logToFile = false;
      }
    }
  }

  /**
   * Determina o diretório de logs seguindo padrão Linux com fallback
   * @returns {string} Caminho do diretório de logs
   */
  determineLogDirectory() {
    // 1. Prioridade: Variável de ambiente
    if (process.env.LOG_DIR) {
      console.log(`Usando LOG_DIR personalizado: ${process.env.LOG_DIR}`);
      return process.env.LOG_DIR;
    }

    // 2. Padrão Linux: /var/log/gicli
    const systemLogDir = '/var/log/gicli';
    try {
      // Tenta criar o diretório para testar permissões
      if (!existsSync(systemLogDir)) {
        mkdirSync(systemLogDir, { recursive: true });
      }
      console.log(`Usando diretório padrão Linux: ${systemLogDir}`);
      return systemLogDir;
    } catch (error) {
      console.warn(`Não foi possível usar /var/log/gicli: ${error.message}`);
    }

    // 3. Fallback: ~/.gicli/logs
    const fallbackDir = join(homedir(), '.gicli', 'logs');
    console.log(`Usando diretório fallback: ${fallbackDir}`);
    return fallbackDir;
  }

  /**
   * Define o nível de log
   * @param {string} level - DEBUG, INFO, WARN, ERROR
   */
  setLevel(level) {
    const upperLevel = level.toUpperCase();
    if (LOG_LEVELS[upperLevel] !== undefined) {
      this.logLevel = LOG_LEVELS[upperLevel];
    }
  }

  /**
   * Ativa/desativa modo silencioso
   * @param {boolean} silent - True para silencioso
   */
  setSilent(silent) {
    this.silent = silent;
  }

  /**
   * Registra um evento de log
   * @param {string} level - Nível do log
   * @param {string} message - Mensagem
   * @param {any} data - Dados adicionais (opcional)
   */
  log(level, message, data = null) {
    const levelNum = LOG_LEVELS[level.toUpperCase()];
    if (levelNum === undefined || levelNum < this.logLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[levelNum];
    const logEntry = {
      timestamp,
      level: levelName,
      message,
      data
    };

    // Formata a mensagem para console
    let consoleMessage = `[${timestamp}] ${levelName}: ${message}`;
    if (data) {
      consoleMessage += ` ${JSON.stringify(data, null, 2)}`;
    }

    // Exibe no console se não estiver em modo silencioso
    if (!this.silent) {
      const consoleMethod = levelNum >= LOG_LEVELS.ERROR ? 'error' :
                           levelNum >= LOG_LEVELS.WARN ? 'warn' : 'log';
      console[consoleMethod](consoleMessage);
    }

    // Salva em arquivo se habilitado
    if (this.logToFile) {
      this.writeToFile(logEntry);
    }
  }

  /**
   * Registra erro
   * @param {string} message - Mensagem de erro
   * @param {Error} error - Objeto de erro (opcional)
   */
  error(message, error = null) {
    const errorData = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : null;

    this.log('ERROR', message, errorData);
  }

  /**
   * Registra início de execução de job
   * @param {string} jobId - ID do job
   * @param {object} metadata - Metadados adicionais (opcional)
   */
  jobStart(jobId, metadata = null) {
    this.log('INFO', `Iniciando execução do job: ${jobId}`, metadata);
  }

  /**
   * Registra fim de execução de job
   * @param {string} jobId - ID do job
   * @param {object} result - Resultado da execução (opcional)
   * @param {number} duration - Duração em ms (opcional)
   */
  jobEnd(jobId, result = null, duration = null) {
    const metadata = {
      result: result ? 'SUCCESS' : 'COMPLETED',
      duration: duration ? `${duration}ms` : undefined
    };

    this.log('INFO', `Job ${jobId} finalizado`, metadata);
  }

  /**
   * Registra erro em execução de job
   * @param {string} jobId - ID do job
   * @param {Error} error - Erro ocorrido
   * @param {number} duration - Duração até o erro (opcional)
   */
  jobError(jobId, error, duration = null) {
    const metadata = {
      duration: duration ? `${duration}ms` : undefined
    };

    this.error(`Erro na execução do job ${jobId}`, error);
  }

  /**
   * Log de debug
   * @param {string} message - Mensagem
   * @param {any} data - Dados adicionais
   */
  debug(message, data = null) {
    this.log('DEBUG', message, data);
  }

  /**
   * Log de informação
   * @param {string} message - Mensagem
   * @param {any} data - Dados adicionais
   */
  info(message, data = null) {
    this.log('INFO', message, data);
  }

  /**
   * Log de aviso
   * @param {string} message - Mensagem
   * @param {any} data - Dados adicionais
   */
  warn(message, data = null) {
    this.log('WARN', message, data);
  }

  /**
   * Escreve entrada de log no arquivo
   * @param {object} logEntry - Entrada de log
   */
  writeToFile(logEntry) {
    try {
      const logFile = this.getCurrentLogFile();
      const logLine = JSON.stringify(logEntry) + '\n';

      appendFileSync(logFile, logLine);

      // Verifica se precisa rotacionar
      this.checkRotation(logFile);
    } catch (error) {
      // Em caso de erro na escrita, tenta console como fallback
      if (!this.silent) {
        console.error('Erro ao escrever log em arquivo:', error.message);
      }
    }
  }

  /**
   * Obtém o caminho do arquivo de log atual
   * @returns {string} Caminho do arquivo
   */
  getCurrentLogFile() {
    return join(this.logDir, 'app.log');
  }

  /**
   * Verifica se o arquivo de log precisa ser rotacionado
   * @param {string} logFile - Caminho do arquivo
   */
  checkRotation(logFile) {
    try {
      const stats = statSync(logFile);
      if (stats.size > this.maxLogSize) {
        this.rotateLogFile();
      }
    } catch (error) {
      // Ignora erros na verificação de rotação
    }
  }

  /**
   * Rotaciona arquivo de log
   */
  rotateLogFile() {
    try {
      // Remove o arquivo mais antigo se existir
      const oldestFile = join(this.logDir, `app.log.${this.maxLogFiles}`);
      if (existsSync(oldestFile)) {
        unlinkSync(oldestFile);
      }

      // Rotaciona os arquivos existentes
      for (let i = this.maxLogFiles - 1; i >= 1; i--) {
        const currentFile = join(this.logDir, `app.log.${i}`);
        const nextFile = join(this.logDir, `app.log.${i + 1}`);

        if (existsSync(currentFile)) {
          renameSync(currentFile, nextFile);
        }
      }

      // Move o arquivo atual
      const currentFile = join(this.logDir, 'app.log');
      const rotatedFile = join(this.logDir, 'app.log.1');

      if (existsSync(currentFile)) {
        renameSync(currentFile, rotatedFile);
      }

      console.log('Arquivo de log rotacionado');
    } catch (error) {
      if (!this.silent) {
        console.error('Erro ao rotacionar arquivo de log:', error.message);
      }
    }
  }

  /**
   * Lista arquivos de log disponíveis
   * @returns {string[]} Lista de arquivos
   */
  listLogFiles() {
    try {
      const files = readdirSync(this.logDir);
      return files.filter(file => file.startsWith('app.log')).sort();
    } catch (error) {
      return [];
    }
  }

  /**
   * Limpa todos os arquivos de log
   */
  clearLogs() {
    try {
      const files = this.listLogFiles();

      for (const file of files) {
        unlinkSync(join(this.logDir, file));
      }

      console.log('Arquivos de log removidos');
    } catch (error) {
      if (!this.silent) {
        console.error('Erro ao limpar logs:', error.message);
      }
    }
  }
}

// Instância singleton do serviço
const loggerService = new LoggerService();

// Configuração baseada em variáveis de ambiente
if (process.env.LOG_LEVEL) {
  loggerService.setLevel(process.env.LOG_LEVEL);
}

if (process.env.LOG_SILENT === 'true') {
  loggerService.setSilent(true);
}

export default loggerService;
export { LoggerService, LOG_LEVELS };
