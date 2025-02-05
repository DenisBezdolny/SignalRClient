import { Routes } from '@angular/router';
import { RoomComponent } from './room/room.component';

export const routes: Routes = [
  { path: '', redirectTo: 'room', pathMatch: 'full' }, // Перенаправление на RoomComponent
  { path: 'room', component: RoomComponent },
];