/**
 * Serviço de Sessão
 * Gerencia armazenamento temporário de dados de sessão (tokens, etc.)
 */

class SessionService {
  constructor() {
    this.sessions = new Map(); // Map<key, {value, expiresAt}>
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Limpa a cada minuto
  }

  /**
   * Armazena um valor na sessão com TTL opcional
   * @param {string} key - Chave da sessão
   * @param {any} value - Valor a armazenar
   * @param {number} ttlSeconds - Tempo de vida em segundos (opcional)
   */
  set(key, value, ttlSeconds = null) {
    const expiresAt = ttlSeconds ? Date.now() + (ttlSeconds * 1000) : null;

    this.sessions.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });
  }

  /**
   * Recupera um valor da sessão
   * @param {string} key - Chave da sessão
   * @returns {any|null} Valor ou null se não encontrado/expirado
   */
  get(key) {
    const session = this.sessions.get(key);

    if (!session) return null;

    // Verifica se expirou
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.delete(key);
      return null;
    }

    return session.value;
  }

  /**
   * Verifica se uma chave existe e não expirou
   * @param {string} key - Chave da sessão
   * @returns {boolean} True se existe e válida
   */
  has(key) {
    const session = this.sessions.get(key);

    if (!session) return false;

    // Verifica se expirou
    if (session.expiresAt && Date.now() > session.expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Remove uma sessão
   * @param {string} key - Chave da sessão
   */
  delete(key) {
    this.sessions.delete(key);
  }

  /**
   * Renova o TTL de uma sessão existente
   * @param {string} key - Chave da sessão
   * @param {number} ttlSeconds - Novo tempo de vida
   * @returns {boolean} True se renovado, false se não encontrado
   */
  renew(key, ttlSeconds) {
    const session = this.sessions.get(key);

    if (!session) return false;

    session.expiresAt = Date.now() + (ttlSeconds * 1000);
    return true;
  }

  /**
   * Lista todas as chaves ativas
   * @returns {string[]} Array de chaves
   */
  keys() {
    const activeKeys = [];

    for (const [key, session] of this.sessions) {
      if (!session.expiresAt || Date.now() <= session.expiresAt) {
        activeKeys.push(key);
      }
    }

    return activeKeys;
  }

  /**
   * Limpa sessões expiradas
   */
  cleanup() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, session] of this.sessions) {
      if (session.expiresAt && now > session.expiresAt) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => this.sessions.delete(key));
  }

  /**
   * Limpa todas as sessões
   */
  clear() {
    this.sessions.clear();
  }

  /**
   * Obtém estatísticas das sessões
   * @returns {object} Estatísticas
   */
  getStats() {
    const now = Date.now();
    let active = 0;
    let expired = 0;

    for (const session of this.sessions.values()) {
      if (!session.expiresAt || now <= session.expiresAt) {
        active++;
      } else {
        expired++;
      }
    }

    return {
      total: this.sessions.size,
      active,
      expired
    };
  }
}

// Instância singleton do serviço
const sessionService = new SessionService();

export default sessionService;
export { SessionService };
