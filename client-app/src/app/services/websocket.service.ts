import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject} from 'rxjs';
import * as signalR from '@microsoft/signalr';


export interface Participant {
  id: string;
  name: string;
  publicIp?: string;  // Добавлено для публичного IP
  publicPort?: number;  // Добавлено для публичного порта
}

@Injectable({
  providedIn: 'root',
})
export class WebSocketService {
  public connection: signalR.HubConnection;
  public roomName: string = "";
  private participants: Participant[] = [];
  public currentUserId: string | null = null;
  public isConnected: boolean = false;
  private connectionStateSubject = new BehaviorSubject<boolean>(false);
  public connectionState$ = this.connectionStateSubject.asObservable();

   // Добавляем Subject для отправки предложений WebRTC
  public offerReceivedSubject = new Subject<{ senderId: string, offer: string }>();
  // Добавляем Subject для получения ответа WebRTC
  public answerReceivedSubject = new Subject<{ senderId: string, answer: string }>();
  // Subject для отправки сигналов P2P
  public initiateP2PConnectionSubject = new Subject<{ participantId: string, publicIp: string, publicPort: number }>();
  // Добавьте этот Subject рядом с другими
  public iceCandidateReceivedSubject = new Subject<{ senderId: string, candidate: string }>();

  // Создаем BehaviorSubject для передачи данных P2P
  public p2pStatusChanged: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);


  // Параметры для подключения и обработки P2P
  private stunServer: string = "stun:stun.l.google.com:19302";
  public isConnectionReady: boolean = false;

  constructor() {
    console.log("Инициализация WebSocketService");
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('https://localhost:7283/notifications')
      .configureLogging(signalR.LogLevel.Information)
      .withAutomaticReconnect([0, 2000, 5000, 10000])
      .build();
  }

  public startConnection(): void {
    this.connection
      .start()
      .then(() => {
        this.isConnected = true;
        this.isConnectionReady = true;
        this.connectionStateSubject.next(true);
        this.registerEventHandlers();

        this.connection.invoke("RequestSTUNInfo")
          .catch(err => console.error("❌ Ошибка при запросе STUN:", err));

        this.connection.invoke("GetConnectionId")
          .then((id: string) => {
            this.currentUserId = id;
          })
          .catch(err => console.error("❌ Ошибка получения ConnectionId:", err));
          
      })
      .catch((err) => {
        this.isConnected = false;
        this.isConnectionReady = false;
        this.connectionStateSubject.next(false);
        console.error("❌ Ошибка подключения:", err);
      });
  }

  // Присоединение к комнате
  public joinRoom(roomName: string): Promise<void> {
    return this.connection.invoke('JoinRoom', roomName, 10)
      .then(() => {
        this.roomName = roomName;
        this.getPublicIP();
      })
      .catch((err) => {
        console.error('❌ Ошибка входа в комнату:', err);
      });
  }

  // Подключение к случайной комнате
  public joinRandomRoom(): Promise<void> {
    return this.connection.invoke('JoinRandomRoom', 10)
      .then(() => {
        this.getPublicIP();
      })
      .catch((err) => {
        console.error('❌ Ошибка случайного подключения:', err);
      });
  }

  public createRoom(maxSize: number): Promise<void>{
    return this.connection.invoke('CreatePrivateRoom',maxSize)
    .then(() => {
      this.getPublicIP();
    })
    .catch((err) => {
      console.error('❌ Ошибка случайного подключения:', err);
    });
  }

  public leaveRoom(roomName: string): void {
    console.log(`📤 Выход из комнаты: ${roomName}`);
    this.connection.invoke('LeaveRoom', roomName)
      .then(() => {
        this.roomName = "";
      })
      .catch((err: Error) => console.error('❌ Ошибка выхода из комнаты:', err));
  }

  public onMessageReceived(callback: (sender: string, message: string) => void): void {
    this.connection.on("ReceiveMessage", (sender: string, message: string) => {
      console.log(`📩 Сообщение от ${sender}: ${message}`);
      const match = message.match(/Welcome to room (\w+)\./);
      if (match) {
        this.roomName = match[1];
        console.log("[WebSocket] 🏠 Код комнаты установлен:", this.roomName);
      }
  
      // Если это предложение WebRTC
      if (message.startsWith('offer:')) {
        const offer = message.slice(6);  // Убираем префикс 'offer:'
        this.offerReceivedSubject.next({ senderId: sender, offer }); // Отправляем через Subject
      }
  
      callback(sender, message);
    });
  }

  public onParticipantsUpdated(callback: (participants: Participant[]) => void): void {
    this.connection.on("UpdateRoomParticipants", (participants: Participant[]) => {
      console.log("👥 Обновление списка участников:", participants);

      // Логируем каждого участника
    participants.forEach((participant) => {
      console.log(`Участник: ${participant.name}, ID: ${participant.id}, IP: ${participant.publicIp}, Порт: ${participant.publicPort}`);
    });

      this.participants = participants;
      callback(participants);
    });
  }

  // Отправка сообщения в комнату
  public sendMessage(roomName: string, message: string): void {
    this.connection.invoke('SendMessageToRoom', roomName, message)
      .then(() => console.log("✅ Сообщение успешно отправлено"))
      .catch((err: Error) => console.error('❌ Ошибка отправки сообщения:', err));
  }

  // Получение публичного IP
  public async getPublicIP(): Promise<void> {
    console.log("🌎 Определение публичного IP...");
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }]  // Убедитесь, что используете правильный URL для STUN-сервера
      });
  
      // Создаем data channel для генерации ICE-кандидатов
      peerConnection.createDataChannel("test");
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
  
      peerConnection.onicecandidate = async (event) => {
        if (event.candidate) {
          console.log("🔎 ICE-кандидат найден:", event.candidate.candidate);
          // Извлекаем публичный IP и порт из кандидата
          const candidate = event.candidate.candidate;
          const parts = candidate.split(" ");
          const ip = parts[4];
          const port = parts[5];
          if (!ip.includes(".local") && !ip.startsWith("192.168")) {
            this.sendNATTraversalInfo(ip, parseInt(port));
          }
        }
      };
    } catch (error) {
      console.error("❌ Ошибка при определении публичного IP:", error);
    }
  }

  // Отправка NAT данных
  public sendNATTraversalInfo(publicIp: string, publicPort: number): void {
    if (this.isConnected) {
      this.connection.invoke("SendNATTraversalInfo", this.roomName, publicIp, publicPort)
        .then(() => console.log("✅ NAT данные успешно отправлены"))
        .catch((err: Error) => console.error("❌ Ошибка отправки NAT данных:", err));
    }
  }

  // Получение списка других клиентов в комнате
  public getOtherClientsInRoom(): Participant[] {
    if (!this.currentUserId) return this.participants;
    return this.participants.filter(p => p.id !== this.currentUserId);
  }

  public onNATInfoReceived(callback: (connectionId: string, publicIp: string, publicPort: number) => void): void {
    this.connection.on("ReceiveNATInfo", (connectionId: string, publicIp: string, publicPort: number) => {
      console.log(`📡 Получены NAT-данные от ${connectionId}: ${publicIp}:${publicPort}`);
      
      // Сохраняем полученные NAT-данные для участника
      const participant = this.participants.find(p => p.id === connectionId);
      if (participant) {
        participant.publicIp = publicIp;
        participant.publicPort = publicPort;

        // Логируем данные участника
        console.log(`Участник ${participant.name} (ID: ${participant.id}) - IP: ${participant.publicIp}, Порт: ${participant.publicPort}`);

        
      }
      // Логируем, чтобы удостовериться, что данные корректно получены
      console.log(`МЕТОД onNATInfoReceived Публичный IP: ${publicIp}, Порт: ${publicPort}`);

      // Если это не текущий пользователь и если публичный IP и порт определены, инициируем P2P-соединение
      if (participant && participant.id !== this.currentUserId && participant.publicIp && participant.publicPort) {
        console.log("Инициация P2P-соединения...");
        this.initiateP2PConnectionSubject.next({ 
          participantId: participant.id,
          publicIp: participant.publicIp,
          publicPort: participant.publicPort
        });
      }
      callback(connectionId, publicIp, publicPort);
    });
  }

  public getPublicIpForParticipant(participantId: string): string | null {
    // Найдите участника по ID и верните его публичный IP
    const participant = this.participants.find(p => p.id === participantId);
    return participant ? participant.publicIp ?? null : null;  // Если publicIp не найден или undefined, возвращаем null
  }
  
  public getPublicPortForParticipant(participantId: string): number | null {
    // Найдите участника по ID и верните его публичный порт
    const participant = this.participants.find(p => p.id === participantId);
    return participant ? participant.publicPort ?? null : null;  // Если publicPort не найден или undefined, возвращаем null
  }
  
  public sendIceCandidate(roomName: string, targetConnectionId: string, candidate: string): Promise<void> {
    return this.connection.invoke("SendIceCandidate", roomName, targetConnectionId, candidate)
      .then(() => console.log("✅ ICE-кандидат успешно отправлен"))
      .catch((err) => console.error("❌ Ошибка отправки ICE-кандидата:", err));
  }
  
  // Обработчик событий из хаба
  private registerEventHandlers(): void {
    this.connection.on("ReceiveMessage", (sender: string, message: string) => {
      console.log(`📩 Сообщение от ${sender}: ${message}`);
    });
      // Listen for STUN server response
    this.connection.on("ReceiveStunServer", (stunServer) => {
      console.log(`📡 Получен STUN-сервер: ${stunServer}`);
      this.stunServer = stunServer;
    });    

      // Добавляем обработчик для ReceiveOffer
  this.connection.on("ReceiveOffer", (senderId: string, offer: string) => {
    console.log(`📩 Получено предложение от ${senderId}:`, offer);
    this.offerReceivedSubject.next({ senderId, offer });
  });

  this.connection.on("ReceiveAnswer", (senderId: string, answer: string) => {
    console.log(`📩 Получен answer от ${senderId}:`, answer);
    this.answerReceivedSubject.next({ senderId, answer });
  });
  

  this.connection.on("ReceiveIceCandidate", (senderId: string, candidate: string) => {
    console.log(`📡 Получен ICE-кандидат от ${senderId}:`, candidate);
    this.iceCandidateReceivedSubject.next({ senderId, candidate });
  });

    this.connection.on("ReceiveTURNServer", (turnServer: string) => {
      console.log(`📡 Получен TURN-сервер: ${turnServer}`);
    });
  }
}
