import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { WebSocketService } from './websocket.service';

@Injectable({
  providedIn: 'root'
})
export class P2PService {
  private peerConnections: { [id: string]: RTCPeerConnection } = {};
  public currentUserP2PId: string | null = null;
  private dataChannels: { [id: string]: RTCDataChannel } = {};  // Добавляем хранилище для DataChannels
  private pendingIceCandidates: { [targetId: string]: RTCIceCandidateInit[] } = {};
  public p2pConnectedSubject = new BehaviorSubject<boolean>(false);
  public p2pConnected$ = this.p2pConnectedSubject.asObservable();
  public p2pMessageSubject = new Subject<{ senderId: string, message: string }>();
  private stunServer: string = "stun:stun.l.google.com:19302";

  constructor(private webSocketService: WebSocketService) {
    this.webSocketService.offerReceivedSubject.subscribe(({ senderId, offer }) => {
      this.handleReceivedOffer(senderId, offer);  // Обработка предложения
    });
    this.webSocketService.answerReceivedSubject.subscribe(({ senderId, answer }) => {
      this.handleReceivedAnswer(senderId, answer);
    }); // Обработка ответа
    // Подписка на сигнал, чтобы создать P2P-соединение
    this.webSocketService.initiateP2PConnectionSubject.subscribe(({ participantId, publicIp, publicPort }) => {
      this.createOffer(participantId, publicIp, publicPort);
    });
    // Новая подписка на ICE-кандидаты
  this.webSocketService.iceCandidateReceivedSubject.subscribe(({ senderId, candidate }) => {
    console.log(`[P2PService] Получен ICE-кандидат от ${senderId}:`, candidate);
    const pc = this.peerConnections[senderId];
    if (pc) {
      // Попытка добавить кандидата напрямую
      try {
        const candidateObj = new RTCIceCandidate(JSON.parse(candidate));
        pc.addIceCandidate(candidateObj)
          .then(() => {
            console.log(`[P2PService] ICE-кандидат успешно добавлен для ${senderId}`);
          })
          .catch((err) => {
            console.error(`[P2PService] Ошибка при добавлении ICE-кандидата для ${senderId}:`, err);
          });
      } catch (error) {
        console.error(`[P2PService] Ошибка при парсинге ICE-кандидата для ${senderId}:`, error);
      }
    } else {
      console.warn(`[P2PService] Нет существующего PeerConnection для ${senderId}. Сохраняем ICE-кандидат в буфер.`);
      this.pendingIceCandidates[senderId] = this.pendingIceCandidates[senderId] || [];
      try {
        const candidateObj = JSON.parse(candidate);
        this.pendingIceCandidates[senderId].push(candidateObj);
      } catch (error) {
        console.error(`[P2PService] Ошибка при парсинге ICE-кандидата для буферизации ${senderId}:`, error);
      }
    }
  });
  }

  private setupDataChannel(targetId: string, dataChannel: RTCDataChannel): void {
    dataChannel.onopen = () => {
      console.log(`[ondatachannel] DataChannel открыт для ${targetId}`);
      console.log(`[ondatachannel] Текущее состояние DataChannel: ${dataChannel.readyState}`);
      this.p2pConnectedSubject.next(true);
    };
    dataChannel.onmessage = (event) => {
      console.log(`[ondatachannel] Получено сообщение по P2P для ${targetId}:`, event.data);
      // Эмитируем полученное сообщение через Subject:
      this.p2pMessageSubject.next({ senderId: targetId, message: event.data });
    };
    dataChannel.onclose = () => {
      console.log(`[ondatachannel] DataChannel закрыт для ${targetId}`);
      this.p2pConnectedSubject.next(false);
    };
  }

  // Создает и возвращает RTCPeerConnection
  public createPeerConnection(
    targetId: string,
    publicIp?: string,
    publicPort?: number,
    isOfferer: boolean = false
  ): RTCPeerConnection | null {
    console.log(`[createPeerConnection] Вызываем метод для ${targetId} с publicIp: ${publicIp}, publicPort: ${publicPort}`);
    
    const config = { iceServers: [{ urls: this.stunServer }] };
    const peerConnection = new RTCPeerConnection(config);
    this.peerConnections[targetId] = peerConnection;
    
    console.log(`[createPeerConnection] Инициализация PeerConnection для ${targetId}. ICE сервер: ${this.stunServer}`);
    
    console.log(`[createPeerConnection] Состояние соединения перед добавлением ICE кандидатов: ${peerConnection.iceConnectionState}`);
  
    
    // Привязка обработчиков (onicecandidate, onicegatheringstatechange, oniceconnectionstatechange, создание DataChannel и т.д.)
    peerConnection.onicecandidate = (event) => {
      console.log(`[onicecandidate] Событие для ${targetId} с кандидатом:`, event);
      if (event.candidate) {
        const candidateJSON = event.candidate.toJSON();
        console.log(`[onicecandidate] Найден новый ICE-кандидат для ${targetId}:`, candidateJSON);
        
        if (peerConnection.remoteDescription === null) {
          // Буферизуем кандидата, если remoteDescription ещё не установлен
          this.pendingIceCandidates[targetId] = this.pendingIceCandidates[targetId] || [];
          this.pendingIceCandidates[targetId].push(candidateJSON);
          console.log(`[onicecandidate] ICE-кандидат отложен для ${targetId} (remoteDescription === null).`);
        } else {
          // Выводим дополнительное состояние перед добавлением кандидата
          console.log(`[onicecandidate] Перед добавлением ICE-кандидата для ${targetId}:`);
          console.log(`    signalingState: ${peerConnection.signalingState}`);
          console.log(`    iceConnectionState: ${peerConnection.iceConnectionState}`);
          console.log(`    remoteDescription type: ${peerConnection.remoteDescription?.type}`);
          console.log(`    ICE candidate:`, candidateJSON);
          
          // Отправляем ICE-кандидат через SignalR
          this.webSocketService.sendIceCandidate(this.webSocketService.roomName, targetId, JSON.stringify(candidateJSON));

          peerConnection.addIceCandidate(event.candidate)
            .then(() => {
              console.log(`[onicecandidate] ✅ ICE-кандидат успешно добавлен для ${targetId}.`);
            })
            .catch((err) => {
              console.error(`[onicecandidate] ❌ Ошибка при добавлении ICE-кандидата для ${targetId}:`, err);
              console.error(`[onicecandidate] Stack trace: ${err.stack}`);
              console.error(`[onicecandidate] Текущее signalingState: ${peerConnection.signalingState}`);
              console.error(`[onicecandidate] Текущее iceConnectionState: ${peerConnection.iceConnectionState}`);
              console.error(`[onicecandidate] Текущий remoteDescription:`, peerConnection.remoteDescription);
            });
        }
      } else {
        console.log(`[onicecandidate] Нет ICE кандидатов для ${targetId}, event.candidate - undefined.`);
      }
    };
       
    peerConnection.onicegatheringstatechange = () => {
      console.log(`[onicegatheringstatechange] Состояние сбора ICE-кандидатов для ${targetId}: ${peerConnection.iceGatheringState}`);
    };
    
    peerConnection.oniceconnectionstatechange = () => {
      console.log(`[oniceconnectionstatechange] Состояние соединения для ${targetId}: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === 'connected') {
        console.log(`[oniceconnectionstatechange] P2P соединение установлено для ${targetId}`);
        this.p2pConnectedSubject.next(true);
      } else {
        this.p2pConnectedSubject.next(false);
      }
    };
    
    // Создаем DataChannel только если мы являемся offerer
    if (isOfferer) {
      const dataChannel = peerConnection.createDataChannel('chat');
      this.dataChannels[targetId] = dataChannel;
      this.setupDataChannel(targetId, dataChannel);
    } else {
      // На стороне answerer ожидаем событие ondatachannel
      peerConnection.ondatachannel = (event) => {
        console.log(`[ondatachannel] Получен DataChannel для ${targetId}:`, event.channel.readyState);
        this.setupDataChannel(targetId, event.channel);
        this.dataChannels[targetId] = event.channel;
      };
    }

    peerConnection.onconnectionstatechange = () => {
      console.log(`[onconnectionstatechange] Состояние соединения для ${targetId}: ${peerConnection.connectionState}`);
    };

    console.log(`[createPeerConnection] Завершение создания PeerConnection для ${targetId}`);
    return peerConnection;
  }

  // Метод для отправки сообщений через DataChannel
  public sendMessage(targetId: string, message: string): void {
    const dataChannel = this.dataChannels[targetId];
    if (dataChannel && dataChannel.readyState === 'open') {
      console.log("📡 Sending message via P2P:", message);
      dataChannel.send(message);
    } else {
      console.error("❌ P2P DataChannel не открыт или не существует для этого клиента.");
    }
  }

  // Метод для сброса и добавления отложенных ICE-кандидатов
  public flushPendingIceCandidates(targetId: string, peerConnection: RTCPeerConnection): void {
    const pending = this.pendingIceCandidates[targetId];
    if (pending && pending.length > 0) {
      console.log(`[flushPendingIceCandidates] Для ${targetId} найдено ${pending.length} отложенных кандидатов.`);
      pending.forEach((candidateInit, index) => {
        console.log(`[flushPendingIceCandidates] [Candidate #${index}] Перед добавлением кандидата:`, candidateInit);
        console.log(`[flushPendingIceCandidates] [Candidate #${index}] Текущее remoteDescription:`, peerConnection.remoteDescription);
        console.log(`[flushPendingIceCandidates] [Candidate #${index}] signalingState: ${peerConnection.signalingState}`);
        console.log(`[flushPendingIceCandidates] [Candidate #${index}] iceConnectionState: ${peerConnection.iceConnectionState}`);
        peerConnection.addIceCandidate(new RTCIceCandidate(candidateInit))
          .then(() => {
            console.log(`[flushPendingIceCandidates] [Candidate #${index}] ✅ Кандидат успешно добавлен для ${targetId}.`);
          })
          .catch((err) => {
            console.error(`[flushPendingIceCandidates] [Candidate #${index}] ❌ Ошибка при добавлении кандидата для ${targetId}:`, err);
            console.error(`[flushPendingIceCandidates] [Candidate #${index}] Stack trace: ${err.stack}`);
          });
      });
      delete this.pendingIceCandidates[targetId];
    } else {
      console.log(`[flushPendingIceCandidates] Для ${targetId} нет отложенных кандидатов.`);
    }
  }

  public async handleReceivedOffer(senderId: string, offer: string): Promise<void> {
    console.log(`📩 Обработка предложения от ${senderId}`);
    
    let peerConnection = this.peerConnections[senderId];
    if (!peerConnection) {
      const newPeer = this.createPeerConnection(senderId);
      if (!newPeer) return;
      peerConnection = newPeer;
    } else {
      console.log(`[handleReceivedOffer] Используем существующее соединение для ${senderId}`);
    }
  
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
      console.log(`[handleReceivedOffer] Удаленное описание установлено для ${senderId}`);
      // После установки remoteDescription, добавляем отложенные ICE-кандидаты (если они есть)
      this.flushPendingIceCandidates(senderId, peerConnection);
      
    } catch (error) {
      console.error(`❌ Ошибка при установке удаленного описания для ${senderId}:`, error);
      return;
    }
  
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log(`📩 Отправка ответа ${senderId}:`, JSON.stringify(answer));
    await this.webSocketService.connection.invoke("SendAnswer", this.webSocketService.roomName, senderId, JSON.stringify(answer));
  }
  

  // Метод для создания предложения (offer) — сторона offerer
  public createOffer(targetId: string, publicIp?: string, publicPort?: number): void {
    if (this.peerConnections[targetId]) {
      console.log(`[createOffer] Соединение для ${targetId} уже существует.`);
      return;
    }
    // Передаем NAT-данные, если они есть
    const peerConnection = this.createPeerConnection(targetId, publicIp, publicPort, true);
    if (!peerConnection) return;

    peerConnection.createOffer()
      .then((offer) => {
        console.log(`📩 Отправка предложения для ${targetId}:`, offer);
        return peerConnection.setLocalDescription(offer).then(() => offer);
      })
      .then((offer) => {
        // Отправляем предложение на сервер через WebSocket
        this.webSocketService.connection.invoke(
          "SendOffer",
          this.webSocketService.roomName,
          targetId,
          JSON.stringify(offer)
        );
      })
      .catch((err) => {
        console.error("❌ Ошибка при создании предложения:", err);
      });
    }
  
  // Обработка входящего ответа (answer) — сторона offerer
  public async handleReceivedAnswer(senderId: string, answer: string): Promise<void> {
    console.log(`📩 Обработка answer от ${senderId}`);
    const peerConnection = this.peerConnections[senderId];
    if (!peerConnection) {
      console.error(`❌ Нет существующего соединения для ${senderId}`);
      return;
    }
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      console.log(`✅ Удаленное описание установлено для ${senderId} (answer)`);
      this.flushPendingIceCandidates(senderId, peerConnection);
    } catch (error) {
      console.error(`❌ Ошибка при установке удаленного описания (answer) для ${senderId}:`, error);
    }
  }

  
  public cleanupConnection(targetId: string): void {
    console.log("Содержимое peerConnections:", Object.keys(this.peerConnections));
    console.log("Переданная targetId:", targetId);
    if (this.peerConnections[targetId]) {
      console.log(`[cleanupConnection] Очистка соединения для ${targetId}`);
      // Закрываем PeerConnection и DataChannel, если они существуют
      if (this.dataChannels[targetId]) {
        this.dataChannels[targetId].close();
        delete this.dataChannels[targetId];
      }
      this.peerConnections[targetId].close();
      delete this.peerConnections[targetId];
    }
    if (this.pendingIceCandidates[targetId]) {
      delete this.pendingIceCandidates[targetId];
    }
  }
  



}
