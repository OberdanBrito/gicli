/**
 * Serviço de Resolução de Dependências entre Jobs
 * Responsável por:
 * - Resolver dependências entre jobs usando ordenação topológica
 * - Validar ciclos de dependências
 * - Determinar ordem de execução dos jobs
 */

class DependencyResolver {
  constructor() {
    this.visited = new Set();
    this.visiting = new Set();
    this.executionOrder = [];
  }

  /**
   * Resolve a ordem de execução dos jobs baseado em suas dependências
   * @param {Array} jobs - Lista de jobs com suas dependências
   * @param {string} targetJobId - ID do job alvo (opcional, executa todos se não especificado)
   * @returns {Array} - Ordem de execução dos jobs
   */
  resolveExecutionOrder(jobs, targetJobId = null) {
    // Reset state
    this.visited.clear();
    this.visiting.clear();
    this.executionOrder = [];

    // Criar mapa de jobs por ID para acesso rápido
    const jobMap = new Map();
    jobs.forEach(job => {
      jobMap.set(job.id, job);
    });

    // Validar que todas as dependências existem
    this.validateDependencies(jobs, jobMap);

    // Se targetJobId especificado, resolver apenas para ele e suas dependências
    if (targetJobId) {
      // Primeiro coleta apenas os jobs necessários
      const requiredJobs = this.getRequiredJobs(jobs, targetJobId);

      // Reset state para resolver apenas os jobs necessários
      this.visited.clear();
      this.visiting.clear();
      this.executionOrder = [];

      // Resolve ordem apenas para os jobs necessários
      requiredJobs.forEach(job => {
        if (!this.visited.has(job.id)) {
          this.resolveJobDependencies(jobMap, job.id);
        }
      });
    } else {
      // Resolver para todos os jobs
      jobs.forEach(job => {
        if (!this.visited.has(job.id)) {
          this.resolveJobDependencies(jobMap, job.id);
        }
      });
    }

    // Retornar ordem de execução
    return this.executionOrder;
  }

  /**
   * Resolve dependências de um job específico usando DFS
   * @param {Map} jobMap - Mapa de jobs por ID
   * @param {string} jobId - ID do job atual
   */
  resolveJobDependencies(jobMap, jobId) {
    // Se já visitado, não fazer nada
    if (this.visited.has(jobId)) {
      return;
    }

    // Se está sendo visitado, temos um ciclo
    if (this.visiting.has(jobId)) {
      throw new Error(`Ciclo de dependências detectado envolvendo job: ${jobId}`);
    }

    // Marcar como visitando
    this.visiting.add(jobId);

    const job = jobMap.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} não encontrado`);
    }

    // Resolver dependências recursivamente
    const dependencies = job.dependencies || [];
    for (const depId of dependencies) {
      this.resolveJobDependencies(jobMap, depId);
    }

    // Marcar como visitado
    this.visiting.delete(jobId);
    this.visited.add(jobId);

    // Adicionar à ordem de execução APÓS processar dependências
    this.executionOrder.push(jobId);
  }

  /**
   * Valida se todas as dependências referenciadas existem
   * @param {Array} jobs - Lista de jobs
   * @param {Map} jobMap - Mapa de jobs por ID
   */
  validateDependencies(jobs, jobMap) {
    const errors = [];

    jobs.forEach(job => {
      const dependencies = job.dependencies || [];
      dependencies.forEach(depId => {
        if (!jobMap.has(depId)) {
          errors.push(`Job "${job.id}" depende de "${depId}" que não existe`);
        }
      });
    });

    if (errors.length > 0) {
      throw new Error(`Erros de dependências:\n${errors.join('\n')}`);
    }
  }

  /**
   * Retorna apenas os jobs necessários para executar um job específico
   * @param {Array} jobs - Lista completa de jobs
   * @param {string} targetJobId - ID do job alvo
   * @returns {Array} - Lista filtrada de jobs necessários
   */
  getRequiredJobs(jobs, targetJobId) {
    const jobMap = new Map();
    jobs.forEach(job => jobMap.set(job.id, job));

    const required = new Set();
    const toVisit = [targetJobId];

    while (toVisit.length > 0) {
      const jobId = toVisit.pop();
      if (required.has(jobId)) continue;

      required.add(jobId);
      const job = jobMap.get(jobId);
      if (job && job.dependencies) {
        toVisit.push(...job.dependencies);
      }
    }

    return jobs.filter(job => required.has(job.id));
  }

  /**
   * Detecta se há ciclos nas dependências (método público para validação)
   * @param {Array} jobs - Lista de jobs
   * @returns {boolean} - True se há ciclos
   */
  hasCycles(jobs) {
    try {
      this.resolveExecutionOrder(jobs);
      return false;
    } catch (error) {
      if (error.message.includes('Ciclo de dependências')) {
        return true;
      }
      throw error; // Re-throw other errors
    }
  }
}

module.exports = { DependencyResolver };
