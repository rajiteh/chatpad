import Koa from 'koa';
import { createServer } from 'http';
import WebSocket, { Server } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const app = new Koa();
const server = createServer(app.callback());
const wss = new Server({ server });


interface SyncableRequest {
    type: string
}

interface ClientIdentityRequest {
    type: 'clientIdentity'
    clientIdentity?: string;
}

interface ClientIdentityResponse {
    type: 'clientIdentity'
    clientIdentity: string
}

interface SubscribeRequest {
    type: 'subscribe'
    syncedRevision?: number;
}

interface SubscribeResponse {
    type: 'changes'
    changes: object[]
    currentRevision: number
    partial: boolean
}

interface ChangesRequest {
    type: 'changes'
    requestId: string
    changes: object[]
    partial: boolean
    baseRevision: number
}

interface ChangesResponse {
    type: 'ack'
    requestId: string
}

interface ErrorResponse {
    type: 'error',
    requestId?: string
    message: string
}

let data: string[] = []; // To store the collected data

function handleClientIdentity(ws: WebSocket, request: ClientIdentityRequest) {
    if (request.clientIdentity) {

    }
}
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        let request;

        try {
            request = JSON.parse(message.toString());
        } catch (error) {
            ws.send(JSON.stringify({ error: 'Invalid JSON format' }));
            return;
        }

        switch ((request as SyncableRequest).type) {
            case 'clientIdentity':
                request = request as ClientIdentityRequest
                const clientIdentity = uuidv4();
                ws.send(JSON.stringify({ clientIdentity }));
                break;

            case 'changes':
                const changesRequest = request as ChangesRequest
                if (changesRequest.content && request.clientIdentity) {
                    data.push(request.content);
                    ws.send(JSON.stringify({ status: 'Content appended' }));
                } else {
                    ws.send(JSON.stringify({ error: 'Invalid changes request' }));
                }
                break;

            case 'subscribe':
                ws.send(JSON.stringify({ data }));
                break;

            default:
                ws.send(JSON.stringify({ error: 'Unknown type' }));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server started on http://localhost:${PORT}`);
});