import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { WebSocketService } from '../services/websocket.service';

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
  public isSignalRConnected: boolean = false; // SignalR соединение
  public isP2PConnected: boolean = false; // P2P соединение
  public participants: string[] = [];

  private peerConnection!: RTCPeerConnection; 

  constructor(private webSocketService: WebSocketService) {}

  ngOnInit(): void {
    this.webSocketService.startConnection();

    this.setupPeerConnection();

    // Подписка на обновления соединения через SignalR
    this.webSocketService.connectionState$.subscribe((state) => {
      this.isSignalRConnected = state;
    });

    // Подписка на входящие сообщения
    this.webSocketService.onMessageReceived((sender: string, message: string) => {
      this.messages.push(`${sender}: ${message}`);
    });

    // Подписка на обновления списка участников
    this.webSocketService.onParticipantsUpdated((participants: string[]) => {
      this.participants = participants;
    });
  }

  joinRoom(): void {
    if (this.roomName) {
      this.webSocketService.joinRoom(this.roomName);

      // Wait a bit and check if other users are in the room
  setTimeout(() => {
    const otherClients = this.webSocketService.getOtherClientsInRoom();
    if (otherClients.length > 0) {
      console.log(`📞 Calling peer: ${otherClients[0]}`);
      this.webSocketService.callPeer(otherClients[0]);
        }
      }, 2000);
    }
  }

  joinRandomRoom(): void {
    this.webSocketService.joinRandomRoom();
    
    // Wait a bit and check if other users are in the room
  setTimeout(() => {
    const otherClients = this.webSocketService.getOtherClientsInRoom();
    if (otherClients.length > 0) {
      console.log(`📞 Calling peer: ${otherClients[0]}`);
      this.webSocketService.callPeer(otherClients[0]);
        }
      }, 2000);
  }

  leaveRoom(): void {
    if (this.webSocketService.roomName) {
      this.webSocketService.leaveRoom(this.webSocketService.roomName);
    }
  }

  sendMessage(): void {
    if (!this.webSocketService.roomName) {
      console.error('Ошибка: roomName не задан!');
      return;
    }
    if (this.webSocketService.roomName && this.newMessage) {
      this.webSocketService.sendMessage(this.webSocketService.roomName, this.newMessage);
      this.newMessage = '';
    }
  }

  private setupPeerConnection(): void {
    this.peerConnection = new RTCPeerConnection();
  
    this.peerConnection.addEventListener('iceconnectionstatechange', () => {
      this.isP2PConnected = this.peerConnection.iceConnectionState === 'connected';
    });
  
    this.peerConnection.addEventListener('connectionstatechange', () => {
      this.isP2PConnected = this.peerConnection.connectionState === 'connected';
    });
  }
  
}
