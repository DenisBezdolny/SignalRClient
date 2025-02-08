import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { WebSocketService, Participant } from '../services/websocket.service';
import { P2PService } from '../services/p2p.service';  // Импортируем новый сервис P2P

@Component({
  selector: 'app-room',
  templateUrl: './room.component.html',
  styleUrls: ['./room.component.css'],
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class RoomComponent implements OnInit {
  public messages: string[] = [];
  public roomName: string = '';
  public newMessage: string = '';
  public isSignalRConnected: boolean = false;
  public isP2PConnected: boolean = false;
  public participants: Participant[] = [];

  constructor(
    private webSocketService: WebSocketService,
    private p2pService: P2PService  // Инжектируем P2P-сервис
  ) {}

  ngOnInit(): void {
    this.webSocketService.startConnection();

    // Подписка на состояние SignalR соединения
    this.webSocketService.connectionState$.subscribe((state) => {
      this.isSignalRConnected = state;
    });

    // Подписка на состояние P2P соединения
    this.p2pService.p2pConnected$.subscribe((state) => {
      this.isP2PConnected = state;
    });

    // Подписка на входящие сообщения через SignalR
    this.webSocketService.onMessageReceived((sender: string, message: string) => {
      this.messages.push(`${sender}: ${message}`);
    });
    // Подписка на P2P-сообщения из P2PService
    this.p2pService.p2pMessageSubject.subscribe(({ senderId, message }) => {
      // Добавляем полученное P2P-сообщение в список сообщений, помечая, что оно пришло по P2P
      this.messages.push(`(P2P) ${senderId}: ${message}`);
    });
  
    // Подписка на получение NAT-данных
    this.webSocketService.onNATInfoReceived((connectionId: string, publicIp: string, publicPort: number) => {
      console.log(`Получены NAT-данные: ${publicIp}:${publicPort} от ${connectionId}`);
    });

    // Подписка на обновление списка участников
    this.webSocketService.onParticipantsUpdated((participants: Participant[]) => {
      this.participants = participants;
      
      if (participants.length > 1) {
        participants.forEach(participant => {
          if (participant.id !== this.webSocketService.currentUserId) {
            const publicIp = this.webSocketService.getPublicIpForParticipant(participant.id);
            const publicPort = this.webSocketService.getPublicPortForParticipant(participant.id);
            
            if (publicIp && publicPort) {
              ;  // Создаем P2P-соединение с каждым участником
            }
          }
        });
      }
    });
  }

  public joinRoom(): void {
    if (this.roomName) {
      this.webSocketService.joinRoom(this.roomName)
        .then(() => {
          console.log(`✅ Успешно вошли в комнату: ${this.roomName}`);
        })
        .catch((err: Error) => console.error('❌ Ошибка входа в комнату:', err));
    }
  }

  public joinRandomRoom(): void {
    this.webSocketService.joinRandomRoom()
      .then(() => {
        console.log("✅ Подключены к случайной комнате");
      })
      .catch((err) => console.error('❌ Ошибка случайного подключения:', err));
  }

  public leaveRoom(): void {
    if (this.webSocketService.roomName) {
      this.webSocketService.leaveRoom(this.webSocketService.roomName);
    }
  }

  sendMessage(): void {
    if (this.webSocketService.roomName && this.newMessage) {
      this.webSocketService.sendMessage(this.webSocketService.roomName, this.newMessage);
      this.newMessage = '';
    }
  }

  sendByP2P(): void {
    // Получаем всех других участников комнаты, кроме текущего
    const otherClients = this.webSocketService.getOtherClientsInRoom();
  
    if (this.isP2PConnected && otherClients.length > 0) {
      console.log("📡 Sending message via P2P:", this.newMessage);
      // Отправляем сообщение через P2P
      this.p2pService.sendMessage(otherClients[0].id, this.newMessage);  // Отправляем первому клиенту
      this.newMessage = '';
    } else {
      console.error("❌ P2P-соединение не установлено или нет других участников.");
    }
  }
  
}
