import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import * as signalR from '@microsoft/signalr';

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  private connection: signalR.HubConnection;
  private peerConnections: { [id: string]: RTCPeerConnection } = {};
  public roomName: string = "";
  private stunServer: string = "stun:stun.l.google.com:19302";
  private turnServer: string = "turn:my-turn-server.com";
  private participants: string[] = []; // Store participants in the room
  public currentUserId: string | null = null;  // Allow null for currentUserId

  constructor() {
    console.log("Инициализация WebSocketService");
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7283/notifications')
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect([0, 2000, 5000, 10000]) // Добавляем авто-переподключение
      .build();
  }

  public isConnected: boolean = false;
  private connectionStateSubject = new BehaviorSubject<boolean>(false);
  public connectionState$ = this.connectionStateSubject.asObservable();

  startConnection(): void {
    console.log("Запуск подключения...");
  
    this.connection
      .start()
      .then(() => {
        this.isConnected = true;
        this.connectionStateSubject.next(true);
        console.log("✅ Подключение установлено");
  
        // Listen for STUN server response
        this.connection.on("ReceiveStunServer", (stunServer) => {
          console.log(`📡 Получен STUN-сервер: ${stunServer}`);
          this.stunServer = stunServer; 
        });
  
        // Listen for ICE candidates from other peers
        this.connection.on("ReceiveIceCandidate", (senderId, candidate) => {
          console.log(`📡 Получен ICE-кандидат от ${senderId}`);
          if (this.peerConnections[senderId]) {
            this.peerConnections[senderId].addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)))
              .catch(err => console.error("❌ Ошибка при добавлении ICE-кандидата:", err));
          }
        });
  
        // Listen for WebRTC offer
        this.connection.on("ReceiveOffer", async (senderId, offer) => {
          console.log(`📩 Получено предложение от ${senderId}`);
          await this.handleReceivedOffer(senderId, offer);
        });
  
        // Listen for WebRTC answer
        this.connection.on("ReceiveAnswer", async (senderId, answer) => {
          console.log(`📩 Получен ответ от ${senderId}`);
          await this.handleReceivedAnswer(senderId, answer);
        });

        //Get ConnectionId
        this.connection.invoke("GetConnectionId")

        // Request STUN info from the server
        this.connection.invoke("RequestSTUNInfo")
          .catch(err => console.error("❌ Ошибка при запросе STUN:", err));
  
        // Listen for room update message to get participants
        this.connection.on("UpdateRoomParticipants", (participants: string[]) => {
          console.log("👥 Обновление списка участников:", participants);
        
          participants.forEach(peerId => {
            if (peerId !== this.currentUserId) {
              console.log(`⏳ Ожидание ICE-кандидатов перед вызовом ${peerId}`);
        
              this.connection.on("ReceiveIceCandidate", async (senderId, candidate) => {
                if (senderId === peerId) {
                  console.log(`📡 Получен ICE-кандидат от ${peerId}, начинаем звонок`);
                  this.callPeer(peerId);
                }
              });
            }
          });
        });        
      })
      .catch((err) => {
        this.isConnected = false;
        this.connectionStateSubject.next(false);
        console.error("❌ Ошибка подключения:", err);
      });
  }
  

  joinRoom(roomName: string): void {
    console.log(`📩 Отправка запроса на вход в комнату: ${roomName}`);
    this.connection.invoke('JoinRoom', roomName, 10)
      .then(() => console.log(`✅ Успешно вошли в комнату: ${roomName}`))
      .catch((err: Error) => console.error('❌ Ошибка входа в комнату:', err));
  }

  joinRandomRoom(): void {
    console.log("📩 Запрос на случайное подключение к комнате");
    this.connection.invoke('JoinRandomRoom', 10)
      .then(() => console.log("✅ Подключены к случайной комнате"))
      .catch((err) => console.error('❌ Ошибка случайного подключения:', err));
  }

  leaveRoom(roomName: string): void {
    console.log(`📤 Выход из комнаты: ${roomName}`);
    this.connection.invoke('LeaveRoom', roomName)
      .then(() => console.log(`✅ Вышли из комнаты: ${roomName}`))
      .catch((err: Error) => console.error('❌ Ошибка выхода из комнаты:', err));
  }

  sendMessage(roomName: string, message: string): void {
    console.log(`📩 Отправка сообщения в комнату ${roomName}: ${message}`);
    this.connection.invoke('SendMessageToRoom', roomName, message)
      .then(() => console.log("✅ Сообщение успешно отправлено"))
      .catch((err: Error) => console.error('❌ Ошибка отправки сообщения:', err));
  }

  async getPublicIP() {
    console.log("🌎 Определение публичного IP...");
    try {
      const peerConnection = new RTCPeerConnection({ iceServers: [{ urls: this.stunServer }] });
      peerConnection.createDataChannel("test");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log("🔎 ICE-кандидат найден:", event.candidate.candidate);
        }
      };
    } catch (error) {
      console.error("❌ Ошибка при определении публичного IP:", error);
    }
  }

  onMessageReceived(callback: (sender: string, message: string) => void): void {
    this.connection.on('ReceiveMessage', (sender: string, message: string) => {
      console.log(`📩 Сообщение от ${sender}: ${message}`);
  
      // Проверка и обработка сообщения на предмет наличия кода комнаты
      const match = message.match(/Welcome to room (\w+)\./);
      if (match) {
        this.roomName = match[1];
        console.log('[WebSocket] 🏠 Код комнаты установлен:', this.roomName);
      }
  
      // Вызов переданного колбэка для дальнейшей обработки сообщения
      callback(sender, message);
    });
  }
  

  onParticipantsUpdated(callback: (participants: string[]) => void): void {
    this.connection.on('UpdateParticipants', (participants: string[]) => {
      console.log("👥 Обновление списка участников:", participants);
      callback(participants);
    });
  }

  private registerEventHandlers(): void {
    // Handle incoming offer
    this.connection.on("ReceiveOffer", async (senderId: string, offer: string) => {
      console.log(`📩 Получен offer от ${senderId}`);
  
      const peerConnection = this.createPeerConnection(senderId);
      if (!peerConnection) return; // Null check
  
      await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
  
      this.connection.invoke("SendAnswer", "", senderId, JSON.stringify(answer));
    });
  
    // Handle incoming answer
    this.connection.on("ReceiveAnswer", async (senderId: string, answer: string) => {
      console.log(`📩 Получен answer от ${senderId}`);
  
      const peerConnection = this.peerConnections[senderId];
      if (!peerConnection) return; // Null check
  
      await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
    });
  
    // Handle incoming ICE candidate
    this.connection.on("ReceiveIceCandidate", async (senderId: string, candidate: string) => {
      console.log(`📡 Получен ICE-кандидат от ${senderId}`);
  
      const peerConnection = this.peerConnections[senderId];
      if (!peerConnection) return; // Null check
  
      await peerConnection.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
    });
  }

  private createPeerConnection(targetId: string): RTCPeerConnection | null {
    if (!this.stunServer) {
        console.error("❌ STUN сервер не получен!");
        return null;
    }

    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: this.stunServer }]
    });

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`📡 Отправка ICE-кандидата ${targetId}`);
            this.connection.invoke("SendIceCandidate", this.roomName, targetId, JSON.stringify(event.candidate))
                .catch(err => console.error("❌ Ошибка отправки ICE-кандидата:", err));
        }
    };

    this.peerConnections[targetId] = peerConnection;
    return peerConnection;
}

async callPeer(targetId: string) {
  console.log(`📞 Звонок пользователю ${targetId}`);

  const peerConnection = this.createPeerConnection(targetId);
  if (!peerConnection) return; // Ensure peerConnection is not null before proceeding

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  console.log(`📩 Отправка предложения пользователю ${targetId}`);
  this.connection.invoke("SendOffer", this.roomName, targetId, JSON.stringify(offer)) // Changed `roomId` to `roomName`
      .catch(err => console.error("❌ Ошибка отправки предложения:", err));
}

  getOtherClientsInRoom(): string[] {
    const myId = this.connection.connectionId; // Get my connection ID
    return this.participants.filter(id => id !== myId); // Exclude self
  }
  
  async handleReceivedOffer(senderId: string, offer: string) {
    const peerConnection = this.createPeerConnection(senderId);
    if (!peerConnection) return;

    await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    console.log(`📩 Отправка ответа ${senderId}`);
    this.connection.invoke("SendAnswer", this.roomName, senderId, JSON.stringify(answer))
        .catch(err => console.error("❌ Ошибка отправки ответа:", err));
}

async handleReceivedAnswer(senderId: string, answer: string) {
  const peerConnection = this.peerConnections[senderId];
  if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      console.log(`✅ Соединение WebRTC установлено с ${senderId}`);
  }
}




}
