# Asterisk Cache

Biblioteca para cachear filas e agentes do Asterisk AMI, com suporte a eventos em tempo real e reconexão automática.

## Características

### Cache e Eventos
- Cache em tempo real de filas e agentes
- Eventos em tempo real para mudanças de status e pausa
- Agrupamento de eventos para reduzir processamento (delay: 500ms)
- Suporte a múltiplas filas por agente
- Status consistente em todas as filas

### Conexão
- Reconexão automática com o Asterisk
- Timeout de conexão configurável (padrão: 10 segundos)
- Tratamento de erros robusto
- Limpeza automática de listeners e timeouts

### Comandos AMI Suportados
- QueuePause: Pausa um agente em todas as filas
- QueueUnpause: Despausa um agente em todas as filas
- QueueAdd: Adiciona um agente a uma fila
- QueueRemove: Remove um agente de uma fila

### Eventos AMI Monitorados
- QueueMemberStatus: Mudanças de status dos agentes
- QueueMemberAdded: Adição de agentes às filas
- QueueMemberRemoved: Remoção de agentes das filas
- QueueMemberPause: Mudanças de status de pausa
- FullyBooted: Inicialização do Asterisk

## Instalação

```bash
npm install asterisk-cache
```

## Uso

```javascript
const AsteriskCache = require('asterisk-cache');

// Configuração do Asterisk AMI
const config = {
    host: '127.0.0.1',
    port: 5038,
    username: 'admin',
    secret: 'amp111'
};

// Criar instância do cache
const cache = new AsteriskCache(config);

// Conectar ao Asterisk
await cache.connect();

// Eventos de conexão
cache.on('connected', () => {
    console.log('Conectado ao Asterisk');
});

cache.on('disconnected', () => {
    console.log('Desconectado do Asterisk');
});

cache.on('reconnecting', (data) => {
    console.log(`Tentando reconectar em ${data.delay/1000} segundos...`);
});

cache.on('connectionError', (error) => {
    console.error(`Erro de conexão (${error.code}): ${error.message}`);
});

// Eventos de filas e agentes
cache.on('queuesUpdated', (queues) => {
    console.log('Filas atualizadas:', queues);
});

cache.on('memberStatusChanged', (data) => {
    console.log(`Agente ${data.member.extension} mudou de status em ${data.queues.length} filas:`);
    data.queues.forEach(queue => {
        console.log(`- ${queue}`);
    });
    console.log(`Status: ${data.member.status}`);
    console.log(`Pausado: ${data.member.paused}`);
});

cache.on('memberPauseChanged', (data) => {
    console.log(`Agente ${data.member.extension} mudou status de pausa em ${data.queues.length} filas:`);
    data.queues.forEach(queue => {
        console.log(`- ${queue}`);
    });
    console.log(`Pausado: ${data.member.paused}`);
    console.log(`Motivo: ${data.member.pausedReason}`);
});

cache.on('memberAdded', (data) => {
    console.log(`Agente ${data.member.extension} adicionado à fila ${data.queue}`);
});

cache.on('memberRemoved', (data) => {
    console.log(`Agente ${data.member.extension} removido da fila ${data.queue}`);
});

// Métodos disponíveis
const queues = cache.getQueues();
const queue = cache.getQueue('fila1');
const agent = cache.getAgentByExtension('SIP/1001');
const availableAgents = cache.getAvailableAgents('fila1'); // Retorna apenas os agentes com status = 1 e pausa = 0
const queueAgents = cache.getQueueAgents('fila1'); // Retorna todos os agentes de uma fila
const allAgents = cache.getAllAgents(); // Retorna todos os agentes com suas filas

// Exemplo de uso dos novos métodos
console.log('Agentes da fila Suporte:');
queueAgents.forEach(agent => {
    console.log(`- ${agent.name} (${agent.extension})`);
    console.log(`  Status: ${agent.status}`);
    console.log(`  Pausado: ${agent.paused}`);
});

console.log('\nTodos os agentes e suas filas:');
allAgents.forEach(agent => {
    console.log(`- ${agent.name} (${agent.extension})`);
    console.log(`  Filas: ${agent.queues.join(', ')}`);
    console.log(`  Status: ${agent.status}`);
    console.log(`  Pausado: ${agent.paused}`);
});

// Pausar/despausar agente
await cache.pauseMember('SIP/1001', 'Almoço');
await cache.unpauseMember('SIP/1001');

// Adicionar/remover agente de fila
await cache.addMemberToQueue('SIP/1001', 'Juca', 'fila1'); // Adiciona agente à fila
await cache.removeMemberFromQueue('SIP/1001', 'fila1'); // Remove agente da fila

// Desconectar
await cache.disconnect();
```

## Eventos

### Eventos de Conexão

#### connected
Emitido quando a conexão com o Asterisk é estabelecida.
```javascript
// Sem payload
```

#### disconnected
Emitido quando a conexão com o Asterisk é perdida.
```javascript
// Sem payload
```

#### reconnecting
Emitido antes de tentar reconectar ao Asterisk.
```javascript
{
    delay: 5000 // Tempo em milissegundos até a próxima tentativa
}
```

#### connectionError
Emitido quando ocorre qualquer erro de conexão.
```javascript
{
    code: 'TIMEOUT' | 'INVALID_PEER' | 'CONNECTION_ERROR' | 'SOCKET_ERROR' | 'RECONNECTION_ERROR' | 'CLEANUP_ERROR',
    message: 'Descrição do erro'
}
```

### Eventos de Filas e Agentes

#### queuesUpdated
Emitido quando as filas são atualizadas.
```javascript
{
    queues: [
        {
            name: 'fila1',
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
            members: [
                {
                    name: 'Agente 1',
                    extension: 'SIP/1001',
                    stateInterface: 'SIP/1001',
                    membership: 'static',
                    penalty: 0,
                    callsTaken: 0,
                    lastCall: 0,
                    lastPause: 0,
                    loginTime: 0,
                    inCall: 0,
                    status: 1,
                    paused: 0,
                    pausedReason: '',
                    wrapupTime: 0
                }
            ]
        }
    ]
}
```

#### memberStatusChanged
Emitido quando o status de um agente muda.
```javascript
{
    queues: ['fila1', 'fila2'], // Filas afetadas
    member: {
        name: 'Agente 1',
        extension: 'SIP/1001',
        stateInterface: 'SIP/1001',
        membership: 'static',
        penalty: 0,
        callsTaken: 0,
        lastCall: 0,
        lastPause: 0,
        loginTime: 0,
        inCall: 0,
        status: 1,
        paused: 0,
        pausedReason: '',
        wrapupTime: 0
    },
    paused: 0
}
```

#### memberPauseChanged
Emitido quando o status de pausa de um agente muda.
```javascript
{
    queues: ['fila1', 'fila2'], // Filas afetadas
    member: {
        name: 'Agente 1',
        extension: 'SIP/1001',
        stateInterface: 'SIP/1001',
        membership: 'static',
        penalty: 0,
        callsTaken: 0,
        lastCall: 0,
        lastPause: 0,
        loginTime: 0,
        inCall: 0,
        status: 1,
        paused: 1,
        pausedReason: 'Almoço',
        wrapupTime: 0
    },
    paused: 1
}
```

#### memberAdded
Emitido quando um agente é adicionado a uma fila.
```javascript
{
    queue: 'fila1',
    member: {
        name: 'Agente 1',
        extension: 'SIP/1001',
        stateInterface: 'SIP/1001',
        membership: 'static',
        penalty: 0,
        callsTaken: 0,
        lastCall: 0,
        lastPause: 0,
        loginTime: 0,
        inCall: 0,
        status: 1,
        paused: 0,
        pausedReason: '',
        wrapupTime: 0
    }
}
```

#### memberRemoved
Emitido quando um agente é removido de uma fila.
```javascript
{
    queue: 'fila1',
    member: {
        name: 'Agente 1',
        extension: 'SIP/1001',
        stateInterface: 'SIP/1001',
        membership: 'static',
        penalty: 0,
        callsTaken: 0,
        lastCall: 0,
        lastPause: 0,
        loginTime: 0,
        inCall: 0,
        status: 1,
        paused: 0,
        pausedReason: '',
        wrapupTime: 0
    }
}
```

## Métodos

### connect()
Conecta ao Asterisk AMI.

### disconnect()
Desconecta do Asterisk AMI.

### getQueues()
Retorna um array com todas as filas.

### getQueue(queueName)
Retorna uma fila específica.

### getAgentByExtension(extension)
Retorna os dados de um agente pelo ramal, incluindo todas as filas que ele está logado.

### getAvailableAgents(queueName)
Retorna um array com os agentes disponíveis de uma fila específica.
Retorna apenas os agentes com status = 1 e pausa = 0

### getQueueAgents(queueName)
Retorna um array com todos os agentes de uma fila específica.
- `queueName`: Nome da fila
- Retorna um array de agentes com seus dados e a fila

### getAllAgents()
Retorna um array com todos os agentes e suas filas.
- Retorna um array de agentes com seus dados e um array de filas que eles estão logados

### pauseMember(memberInterface, reason)
Pausa um agente em todas as filas que ele está logado.

### unpauseMember(memberInterface)
Despausa um agente em todas as filas que ele está logado.

### addMemberToQueue(memberInterface, memberName, queueName, paused = 0, penalty = 0)
Adiciona um agente a uma fila específica.
- `memberInterface`: Interface do agente (ex: 'SIP/1001')
- `memberName`: Nome do agente (ex: Juca)
- `queueName`: Nome da fila (ex: Suporte)
- `paused`: 1 - Pausado, 0 - Sem pausa. (opcional, padrão: 0)
- `penalty`: Penalidade do agente (opcional, padrão: 0)

### removeMemberFromQueue(memberInterface, queueName)
Remove um agente de uma fila específica.
- `memberInterface`: Interface do agente (ex: 'SIP/1001')
- `queueName`: Nome da fila

## Configuração

```javascript
const config = {
    host: '10.11.31.4',     // IP do Asterisk
    port: 5038,             // Porta do AMI
    username: 'admin',      // Usuário do AMI
    secret: 'amp111'        // Senha do AMI
};
```

## Características Técnicas

- Reconexão automática em caso de desconexão
- Timeout de conexão configurável (padrão: 10 segundos)
- Agrupamento de eventos para reduzir processamento (delay: 500ms)
- Tratamento de erros robusto
- Suporte a múltiplas filas por agente
- Status consistente em todas as filas
- Limpeza automática de listeners e timeouts

## Contribuição

Contribuições são bem-vindas! Por favor, sinta-se à vontade para enviar um Pull Request.

## Licença

MIT 