const AsteriskCache = require('./index');
const readline = require('readline');

// Configuração do Asterisk AMI
const config = {
    host: '127.0.0.1',
    port: 5038,
    username: 'admin',
    secret: 'admin'
};

// Criar interface de leitura
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Função para fazer perguntas ao usuário
function question(query) {
    return new Promise((resolve) => {
        rl.question(query, resolve);
    });
}

// Função para exibir o menu principal
async function showMenu() {
    console.log('\n=== Asterisk Cache CLI ===');
    console.log('1. Listar todas as filas');
    console.log('2. Listar agentes de uma fila');
    console.log('3. Listar todos os agentes');
    console.log('4. Listar agentes disponíveis de uma fila');
    console.log('5. Pausar agente');
    console.log('6. Despausar agente');
    console.log('7. Adicionar agente a uma fila');
    console.log('8. Remover agente de uma fila');
    console.log('9. Sair');
    
    const choice = await question('\nEscolha uma opção: ');
    
    switch (choice) {
        case '1':
            await listQueues();
            break;
        case '2':
            await listQueueAgents();
            break;
        case '3':
            await listAllAgents();
            break;
        case '4':
            await listAvailableAgents();
            break;
        case '5':
            await pauseAgent();
            break;
        case '6':
            await unpauseAgent();
            break;
        case '7':
            await addAgentToQueue();
            break;
        case '8':
            await removeAgentFromQueue();
            break;
        case '9':
            console.log('Saindo...');
            await cache.disconnect();
            rl.close();
            process.exit(0);
            break;
        default:
            console.log('Opção inválida!');
            break;
    }
    
    // Voltar ao menu principal
    await showMenu();
}

// Função para listar todas as filas
async function listQueues() {
    console.log('\n=== Listando todas as filas ===');
    const queues = cache.getQueues();
    console.log(JSON.stringify(queues, null, 2));
}

// Função para listar agentes de uma fila
async function listQueueAgents() {
    console.log('\n=== Listando agentes de uma fila ===');
    const queueName = await question('Nome da fila: ');
    
    const agents = cache.getQueueAgents(queueName);
    
    if (agents.length > 0) {
        console.log(`${agents.length} agentes na fila ${queueName}:`);
        console.log(JSON.stringify(agents, null, 2));
    } else {
        console.log(`Nenhum agente na fila ${queueName} no momento.`);
    }
}

// Função para listar todos os agentes
async function listAllAgents() {
    console.log('\n=== Listando todos os agentes ===');
    const agents = cache.getAllAgents();
    console.log(JSON.stringify(agents, null, 2));
}

// Função para listar agentes disponíveis de uma fila
async function listAvailableAgents() {
    console.log('\n=== Listando agentes disponíveis de uma fila ===');
    const queueName = await question('Nome da fila: ');
    
    const availableAgents = cache.getAvailableAgents(queueName);
    
    if (availableAgents.length > 0) {
        console.log(`${availableAgents.length} agentes disponíveis na fila ${queueName}:`);
        console.log(JSON.stringify(availableAgents, null, 2));
    } else {
        console.log(`Nenhum agente disponível na fila ${queueName} no momento.`);
    }
}

// Função para pausar um agente
async function pauseAgent() {
    console.log('\n=== Pausando um agente ===');
    const extension = await question('Ramal do agente (ex: PJSIP/1001): ');
    const reason = await question('Motivo da pausa (opcional): ');
    
    const result = await cache.pauseMember(extension, reason);
    if (result) {
        console.log('Agente pausado com sucesso!');
    } else {
        console.log('Erro ao pausar agente.');
    }
}

// Função para despausar um agente
async function unpauseAgent() {
    console.log('\n=== Despausando um agente ===');
    const extension = await question('Ramal do agente (ex: PJSIP/1001): ');
    
    const result = await cache.unpauseMember(extension);
    if (result) {
        console.log('Agente despausado com sucesso!');
    } else {
        console.log('Erro ao despausar agente.');
    }
}

// Função para adicionar um agente a uma fila
async function addAgentToQueue() {
    console.log('\n=== Adicionando agente a uma fila ===');
    const extension = await question('Ramal do agente (ex: PJSIP/1001): ');
    const name = await question('Nome do agente: ');
    const queueName = await question('Nome da fila: ');

    const result = await cache.addMemberToQueue(extension, name, queueName);
    
    if (result) {
        console.log('Agente adicionado à fila com sucesso!');
    } else {
        console.log('Erro ao adicionar agente à fila.');
    }
}

// Função para remover um agente de uma fila
async function removeAgentFromQueue() {
    console.log('\n=== Removendo agente de uma fila ===');
    const extension = await question('Ramal do agente (ex: PJSIP/1001): ');
    const queueName = await question('Nome da fila: ');

    const result = await cache.removeMemberFromQueue(extension, queueName);

    if (result) {
        console.log('Agente removido da fila com sucesso!');
    } else {
        console.log('Erro ao remover agente da fila.');
    }
}

// Inicializar o cache
const cache = new AsteriskCache(config);

cache.on('connected', () => {
    console.log('Conexão estabelecida com o Asterisk');
});

cache.on('disconnected', () => {
    console.log('Conexão encerrada');
});

cache.on('connectionError', (error) => {
    console.error('Erro na conexão com o Asterisk:', error);
});

cache.on('reconnecting', ({ delay }) => {
    console.log(`Reconectando em ${delay / 1000} segundos...`);
});

cache.on('queuesUpdated', (queues) => {
    console.log('Filas atualizadas:', queues);
});

cache.on('memberAdded', ({ queue, member }) => {
    console.log('-- memberAdded -- Novo membro adicionado:');
    console.log('Fila:', queue);
    console.log('Membro:', JSON.stringify(member, null, 2));
});

cache.on('memberRemoved', ({ queue, member }) => {
    console.log('-- memberRemoved -- Membro removido:');
    console.log('Fila:', queue);
    console.log('Membro:', JSON.stringify(member, null, 2));
});

cache.on('memberStatusChanged', (data) => {
    console.log('-- memberStatusChanged -- Status do membro alterado:');
    console.log(JSON.stringify(data, null, 2));
});

cache.on('memberPauseChanged', (data) => {
    console.log('-- memberPauseChanged -- Status de pausa alterado:');
    console.log(JSON.stringify(data, null, 2));
});

// Função principal
async function main() {
    try {
        // Conectar ao Asterisk
        console.log('Conectando ao Asterisk...');
        await cache.connect();
        
        // Iniciar o menu
        await showMenu();
    } catch (error) {
        console.error('Erro:', error);
        process.exit(1);
    }
}

// Iniciar o programa
main(); 