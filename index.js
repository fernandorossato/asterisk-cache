/**
 * @description Cache de filas do Asterisk
 * @author Fernando Rossato
 * @email fernando.rossato@gmail.com
 * @version 1.0.0
 * @since 2025-04-28
 * @abstract 
 * Essa classe é responsável por cachear as filas e agentes do Asterisk. 
 * Gera um delay 500ms nos eventos de status e pausas para gerar um evento único para cada agente 
 * independente de quantas filas o agente está.
 * Implementa reconexão automática e timeout de conexão com o Asterisk mesmo sem resposta do servidor.
 */
const { Nami, Actions } = require('nami');
const EventEmitter = require('events');

class AsteriskCache extends EventEmitter {
    constructor(config) {
        super();
        this.config = config;
        this.nami = new Nami(config);
        this.nami.logLevel = 0;
        this.queues = new Map();
        this.isConnected = false;
        this.reconnectInterval = 5000; // 5 segundos
        this.connectTimeout = 10000; // 10 segundos
        this.connectionTimeout = null;
        this.reconnectTimeout = null;
        this.isReconnecting = false;
        this.shouldReconnect = true;
        this.pendingEvents = new Map(); // Mapa para armazenar eventos pendentes
        this.eventTimeout = 500; // Tempo de espera para agrupar eventos (ms)

        // Aumentar o limite de listeners
        this.nami.setMaxListeners(20);
        if (this.nami.socket) {
            this.nami.socket.setMaxListeners(20);
        }

        // Adicionar tratamento de erro global
        process.on('uncaughtException', (error) => {
            if (error.code === 'ECONNREFUSED') {
                this.handleDisconnection();
            }
        });

        // Adicionar tratamento para sinais de encerramento
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    // Método para processar eventos agrupados
    async processPendingEvent(extension, eventType) {
        const event = this.pendingEvents.get(extension);
        if (!event) return;

        // Remover o evento pendente
        this.pendingEvents.delete(extension);
        this.pendingEvents.delete(`${extension}_timeout`);

        // Processar o evento em todas as filas afetadas
        const queues = event.queues || [event.queue];
        
        for (const queueName of queues) {
            const queue = this.queues.get(queueName);
            if (queue) {
                const memberIndex = queue.members.findIndex(m => m.extension === event.interface);
                if (memberIndex !== -1) {
                    const oldMember = queue.members[memberIndex];
                    let newMember;

                    if (eventType === 'QueueMemberStatus') {
                        newMember = {
                            name: event.membername,
                            extension: event.interface,
                            stateInterface: event.stateinterface,
                            membership: event.membership,
                            penalty: parseInt(event.penalty),
                            callsTaken: parseInt(event.callstaken),
                            lastCall: parseInt(event.lastcall),
                            lastPause: parseInt(event.lastpause),
                            loginTime: parseInt(event.logintime),
                            inCall: parseInt(event.incall),
                            status: parseInt(event.status),
                            paused: parseInt(event.paused),
                            pausedReason: event.pausedreason,
                            wrapupTime: parseInt(event.wrapuptime)
                        };
                    } else if (eventType === 'QueueMemberPause') {
                        newMember = {
                            ...oldMember,
                            paused: parseInt(event.paused),
                            pausedReason: event.pausedreason,
                            lastPause: parseInt(event.lastpause)
                        };
                    }

                    if (newMember) {
                        queue.members[memberIndex] = newMember;
                        this.queues.set(queueName, queue);
                    }
                }
            }
        }

        // Emitir evento único com todas as filas afetadas
        if (eventType === 'QueueMemberStatus') {
            const firstQueue = this.queues.get(queues[0]);
            if (firstQueue) {
                const member = firstQueue.members.find(m => m.extension === event.interface);
                if (member) {
                    this.emit('memberStatusChanged', {
                        queues: queues,
                        member: member,
                        paused: member.paused
                    });
                }
            }
        } else if (eventType === 'QueueMemberPause') {
            const firstQueue = this.queues.get(queues[0]);
            if (firstQueue) {
                const member = firstQueue.members.find(m => m.extension === event.interface);
                if (member) {
                    this.emit('memberPauseChanged', {
                        queues: queues,
                        member: member,
                        paused: member.paused
                    });
                }
            }
        }

        this.emit('queuesUpdated', Array.from(this.queues.values()));
    }

    // Método para agendar o processamento do evento
    scheduleEventProcessing(extension, eventType, event) {
        // Verificar se já existe um evento pendente
        const existingEvent = this.pendingEvents.get(extension);
        
        if (existingEvent) {
            // Se já existe um evento pendente, adicionar a fila atual à lista de filas
            if (!existingEvent.queues) {
                existingEvent.queues = [existingEvent.queue];
            }
            if (!existingEvent.queues.includes(event.queue)) {
                existingEvent.queues.push(event.queue);
            }
            
            // Atualizar o evento com os dados mais recentes
            this.pendingEvents.set(extension, {
                ...event,
                queues: existingEvent.queues
            });
        } else {
            // Se não existe evento pendente, criar um novo com a fila atual
            this.pendingEvents.set(extension, {
                ...event,
                queues: [event.queue]
            });
        }

        // Limpar timeout anterior se existir
        if (this.pendingEvents.get(`${extension}_timeout`)) {
            clearTimeout(this.pendingEvents.get(`${extension}_timeout`));
        }

        // Agendar novo processamento
        const timeout = setTimeout(() => {
            this.processPendingEvent(extension, eventType);
        }, this.eventTimeout);

        // Armazenar o timeout
        this.pendingEvents.set(`${extension}_timeout`, timeout);
    }

    async connect() {
        if (this.isReconnecting || !this.shouldReconnect) {
            return;
        }

        try {
            this.isReconnecting = true;

            // Limpar listeners antigos
            this.nami.removeAllListeners('namiConnected');
            this.nami.removeAllListeners('namiConnectionClose');
            this.nami.removeAllListeners('namiInvalidPeer');
            this.nami.removeAllListeners('namiEvent');
            this.nami.removeAllListeners('namiConnectionError');

            if (this.nami.socket) {
                this.nami.socket.removeAllListeners('error');
            }

            // Configurar timeout para a conexão
            this.connectionTimeout = setTimeout(() => {
                this.emit('connectionError', {
                    code: 'TIMEOUT',
                    message: 'Timeout ao conectar ao Asterisk AMI'
                });
                this.handleDisconnection();
            }, this.connectTimeout);
            
            // Configurar eventos
            this.nami.on('namiConnected', () => this.handleConnection());
            this.nami.on('namiConnectionClose', () => this.handleDisconnection());
            this.nami.on('namiInvalidPeer', () => {
                this.emit('connectionError', {
                    code: 'INVALID_PEER',
                    message: 'Credenciais inválidas do Asterisk AMI'
                });
                this.handleDisconnection();
            });
            this.nami.on('namiEvent', (event) => this.handleEvent(event));
            this.nami.on('namiConnectionError', (error) => {
                this.emit('connectionError', {
                    code: 'CONNECTION_ERROR',
                    message: error.message
                });
                this.handleDisconnection();
            });

            // Adicionar tratamento de erro no socket
            if (this.nami.socket) {
                this.nami.socket.on('error', (error) => {
                    this.emit('connectionError', {
                        code: 'SOCKET_ERROR',
                        message: error.message
                    });
                    this.handleDisconnection();
                });
            }
            
            // Tentar conectar
            this.nami.open();
            
        } catch (error) {
            this.emit('connectionError', {
                code: 'CONNECTION_ERROR',
                message: error.message
            });
            this.handleDisconnection();
        } finally {
            this.isReconnecting = false;
        }
    }

    async handleConnection() {
        // Limpar o timeout de conexão
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        this.isConnected = true;
        this.isReconnecting = false;
        this.emit('connected');

        // Adicionar tratamento de erro no socket após a conexão
        if (this.nami.socket) {
            this.nami.socket.removeAllListeners('error');
            this.nami.socket.on('error', (error) => {
                this.emit('connectionError', {
                    code: 'SOCKET_ERROR',
                    message: error.message
                });
                this.handleDisconnection();
            });
        }
    }

    async handleDisconnection() {
        // Limpar o timeout de conexão
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }

        // Limpar o timeout de reconexão anterior
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        
        this.isConnected = false;
        this.emit('disconnected');
        
        if (this.shouldReconnect) {
            // Tentar reconectar indefinidamente
            this.emit('reconnecting', {
                delay: this.reconnectInterval
            });
            
            this.reconnectTimeout = setTimeout(async () => {
                try {
                    await this.connect();
                } catch (error) {
                    this.emit('connectionError', {
                        code: 'RECONNECTION_ERROR',
                        message: error.message
                    });
                }
            }, this.reconnectInterval);
        }
    }

    async cleanup() {
        this.shouldReconnect = false;
        
        // Limpar todos os timeouts
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        // Limpar todos os timeouts de eventos pendentes
        for (const [key, value] of this.pendingEvents.entries()) {
            if (key.endsWith('_timeout')) {
                clearTimeout(value);
            }
        }
        this.pendingEvents.clear();

        // Limpar todos os listeners
        this.nami.removeAllListeners();
        if (this.nami.socket) {
            this.nami.socket.removeAllListeners();
        }

        // Fechar conexão com o Asterisk
        if (this.isConnected) {
            try {
                await this.nami.close();
            } catch (error) {
                this.emit('connectionError', {
                    code: 'CLEANUP_ERROR',
                    message: error.message
                });
            }
        }

        this.emit('disconnected');
        process.exit(0);
    }

    async disconnect() {
        await this.cleanup();
    }

    async handleEvent(event) {
        switch (event.event) {
            case 'FullyBooted':
                await this.updateQueues();
                break;
            case 'QueueMemberStatus':
                // Agendar processamento do evento
                this.scheduleEventProcessing(event.interface, 'QueueMemberStatus', event);
                break;
            case 'QueueMemberAdded':
                await this.handleQueueMemberAdded(event);
                break;
            case 'QueueMemberRemoved':
                await this.handleQueueMemberRemoved(event);
                break;
            case 'QueueMemberPause':
                // Agendar processamento do evento
                this.scheduleEventProcessing(event.interface, 'QueueMemberPause', event);
                break;
        }
    }

    /**
     * @description Envia uma ação para o Asterisk e aguarda a resposta
     * @param {Object} action - Ação a ser enviada
     * @param {number} [timeout=5000] - Timeout em milissegundos
     * @returns {Promise<Object>} Resposta do Asterisk
     * @throws {Error} Se não estiver conectado ou se o timeout for excedido
     */
    async _send(action, timeout = 5000) {
        return new Promise((resolve, reject) => {
            // Verificar se está conectado
            if (!this.isConnected) {
                reject(new Error('Não conectado ao Asterisk'));
                return;
            }

            // Configurar timeout
            const timeoutId = setTimeout(() => {
                reject(new Error(`Timeout ao enviar ação ${action.action} para o Asterisk`));
            }, timeout);

            // Enviar ação
            this.nami.send(action, (response) => {
                // Limpar timeout
                clearTimeout(timeoutId);

                // Verificar se a resposta é válida
                if (!response) {
                    reject(new Error(`Resposta inválida do Asterisk para a ação ${action.action}`));
                    return;
                }

                // Verificar se a resposta indica erro
                if (response.response === 'Error') {
                    reject(new Error(`Erro do Asterisk: ${response.message || 'Erro desconhecido'}`));
                    return;
                }

                resolve(response);
            });
        });
    }

    async handleQueueMemberAdded(event) {
        const queueName = event.queue;
        let queue = this.queues.get(queueName);
        
        if (!queue) {
            queue = {
                name: queueName,
                max: 0,
                strategy: 'ringall',
                calls: 0,
                holdtime: 0,
                talktime: 0,
                completed: 0,
                abandoned: 0,
                servicelevel: 0,
                servicelevelperf: 0,
                servicelevelperf2: 0,
                weight: 0,
                members: []
            };
            this.queues.set(queueName, queue);
        }

        const member = {
            name: event.membername,
            extension: event.interface,
            stateInterface: event.stateinterface,
            membership: event.membership,
            penalty: parseInt(event.penalty),
            callsTaken: parseInt(event.callstaken),
            lastCall: parseInt(event.lastcall),
            lastPause: parseInt(event.lastpause),
            loginTime: parseInt(event.logintime),
            inCall: parseInt(event.incall),
            status: parseInt(event.status),
            paused: parseInt(event.paused),
            pausedReason: event.pausedreason,
            wrapupTime: parseInt(event.wrapuptime)
        };

        const memberIndex = queue.members.findIndex(m => m.extension === member.extension);
        if (memberIndex === -1) {
            queue.members.push(member);
            this.queues.set(queueName, queue);
            
            // Emite evento de adição de membro
            this.emit('memberAdded', {
                queue: queueName,
                member: member
            });
            
            this.emit('queuesUpdated', Array.from(this.queues.values()));
        }
    }

    async handleQueueMemberRemoved(event) {
        const queueName = event.queue;
        const queue = this.queues.get(queueName);
        
        if (queue) {
            const memberIndex = queue.members.findIndex(m => m.extension === event.interface);
            if (memberIndex !== -1) {
                const removedMember = queue.members[memberIndex];
                queue.members.splice(memberIndex, 1);
                this.queues.set(queueName, queue);
                
                // Emite evento de remoção de membro
                this.emit('memberRemoved', {
                    queue: queueName,
                    member: removedMember
                });
                
                this.emit('queuesUpdated', Array.from(this.queues.values()));
            }
        }
    }

    async updateQueues() {
        try {
            const response = await this._send(new Actions.QueueStatus());
            // console.log('queueStatus', JSON.stringify(response, null, 2));
            
            if (response && response.events) {
                this.queues.clear();
                let currentQueue = null;

                for (const event of response.events) {
                    if (event.event === 'QueueParams') {
                        currentQueue = {
                            name: event.queue,
                            max: parseInt(event.max),
                            strategy: event.strategy,
                            calls: parseInt(event.calls),
                            holdtime: parseInt(event.holdtime),
                            talktime: parseInt(event.talktime),
                            completed: parseInt(event.completed),
                            abandoned: parseInt(event.abandoned),
                            servicelevel: parseInt(event.servicelevel),
                            servicelevelperf: parseFloat(event.servicelevelperf),
                            servicelevelperf2: parseFloat(event.servicelevelperf2),
                            weight: parseInt(event.weight),
                            members: []
                        };
                        this.queues.set(event.queue, currentQueue);
                    } else if (event.event === 'QueueMember' && currentQueue) {
                        currentQueue.members.push({
                            name: event.name,
                            extension: event.location,
                            stateInterface: event.stateinterface,
                            membership: event.membership,
                            penalty: parseInt(event.penalty),
                            callsTaken: parseInt(event.callstaken),
                            lastCall: parseInt(event.lastcall),
                            lastPause: parseInt(event.lastpause),
                            loginTime: parseInt(event.logintime),
                            inCall: parseInt(event.incall),
                            status: parseInt(event.status),
                            paused: parseInt(event.paused),
                            pausedReason: event.pausedreason,
                            wrapupTime: parseInt(event.wrapuptime)
                        });
                    }
                }
                this.emit('queuesUpdated', Array.from(this.queues.values()));
            }
        } catch (error) {
            console.error('Erro ao atualizar filas:', error);
        }
    }

    getQueues() {
        return Array.from(this.queues.values());
    }

    getQueue(queueName) {
        return this.queues.get(queueName);
    }

    // Método para obter dados de um agente pelo ramal
    getAgentByExtension(extension) {
        const allQueues = this.getQueues();
        const agentQueues = [];
        let agentData = null;
        
        for (const queue of allQueues) {
            const member = queue.members.find(m => m.extension === extension);
            if (member) {
                agentQueues.push(queue.name);
                // Usar os dados do primeiro agente encontrado
                if (!agentData) {
                    agentData = {
                        ...member,
                        queue: queue.name
                    };
                }
            }
        }
        
        if (agentData) {
            agentData.queues = agentQueues;
        }
        
        return agentData;
    }

    // Método para obter apenas os agentes disponíveis (status=1 e pausa=0) de uma fila específica
    getAvailableAgents(queueName) {
        const queue = this.queues.get(queueName);
        
        if (!queue) {
            return [];
        }
        
        const availableMembers = queue.members.filter(m => m.status === 1 && m.paused === 0);
        
        return availableMembers.map(member => ({
            ...member,
            queue: queueName
        }));
    }

    async pauseMember(memberInterface, reason = '') {
        try {
            const response = await this._send(new Actions.QueuePause(memberInterface, undefined, reason));
            
            if (response && response.response === 'Success') {
                console.log(`Membro ${memberInterface} pausado`);
                return true;
            } else {
                console.error(`Erro ao pausar membro ${memberInterface}:`, response);
                return false;
            }
        } catch (error) {
            console.error(`Erro ao pausar membro ${memberInterface}:`, error);
            return false;
        }
    }

    async unpauseMember(memberInterface) {
        try {
            const response = await this._send(new Actions.QueueUnpause(memberInterface));
            
            if (response && response.response === 'Success') {
                console.log(`Membro ${memberInterface} despausado`);
                return true;
            } else {
                console.error(`Erro ao despausar membro ${memberInterface}:`, response);
                return false;
            }
        } catch (error) {
            console.error(`Erro ao despausar membro ${memberInterface}:`, error);
            return false;
        }
    }

    async addMemberToQueue(memberInterface, memberName, queueName, paused = 0, penalty = 0) {
        try {
            const response = await this._send(new Actions.QueueAdd(memberInterface, queueName, paused, memberName, penalty));
            
            if (response && response.response === 'Success') {
                console.log(`Membro ${memberInterface} adicionado à fila ${queueName}`);
                return true;
            } else {
                console.error(`Erro ao adicionar membro ${memberInterface} à fila ${queueName}:`, response);
                return false;
            }
        } catch (error) {
            console.error(`Erro ao adicionar membro ${memberInterface} à fila ${queueName}:`, error);
            return false;
        }
    }

    async removeMemberFromQueue(memberInterface, queueName) {
        try {
            const response = await this._send(new Actions.QueueRemove(memberInterface, queueName)); 
            
            if (response && response.response === 'Success') {
                console.log(`Membro ${memberInterface} removido da fila ${queueName}`);
                return true;
            } else {
                console.error(`Erro ao remover membro ${memberInterface} da fila ${queueName}:`, response);
                return false;
            }
        } catch (error) {
            console.error(`Erro ao remover membro ${memberInterface} da fila ${queueName}:`, error);
            return false;
        }
    }

    // Método para obter todos os agentes de uma fila específica
    getQueueAgents(queueName) {
        const queue = this.queues.get(queueName);
        
        if (!queue) {
            return [];
        }
        
        return queue.members.map(member => ({
            ...member,
            queue: queueName
        }));
    }

    // Método para obter todos os agentes com suas filas
    getAllAgents() {
        const agents = new Map(); // Usar Map para evitar duplicatas
        
        for (const [queueName, queue] of this.queues.entries()) {
            for (const member of queue.members) {
                if (!agents.has(member.extension)) {
                    agents.set(member.extension, {
                        ...member,
                        queues: [queueName]
                    });
                } else {
                    const agent = agents.get(member.extension);
                    if (!agent.queues.includes(queueName)) {
                        agent.queues.push(queueName);
                    }
                }
            }
        }
        
        return Array.from(agents.values());
    }
}

module.exports = AsteriskCache; 