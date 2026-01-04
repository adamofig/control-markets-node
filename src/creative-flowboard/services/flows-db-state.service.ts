import { Injectable } from '@nestjs/common';
import { IFlowExecutionState } from '../models/creative-flowboard.models';
// import * as admin from 'firebase-admin';
import { FirebaseService } from '@dataclouder/nest-auth';
import * as admin from 'firebase-admin';

@Injectable()
export class FlowsDbStateService {
  private db: admin.firestore.Firestore;

  constructor(private firebaseService: FirebaseService) {
    // Not sure why, if i import firebaseService, process hapends first so my app is initialized in that component.
    if (admin.apps.length === 0) {
      console.warn('Firebase Admin SDK not initialized. Attempting default initialization.');
    }
    this.db = admin.firestore();
  }

  async createFirebaseLog(log: IFlowExecutionState): Promise<IFlowExecutionState> {
    const logRef = this.db.collection('flows_execution_state').doc(log.flowExecutionId);
    await logRef.set({
      ...log,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const snapshot = await logRef.get();
    return snapshot.data() as IFlowExecutionState;
  }

  async updateFirestore(id: string, partialExecutionState: Partial<IFlowExecutionState>): Promise<IFlowExecutionState> {
    const logRef = this.db.collection('flows_execution_state').doc(id);
    await logRef.update({
      ...partialExecutionState,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const snapshot = await logRef.get();
    return snapshot.data() as IFlowExecutionState;
  }

  async findOne(id: string): Promise<IFlowExecutionState | null> {
    const logRef = this.db.collection('flows_execution_state').doc(id);
    const snapshot = await logRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return snapshot.data() as IFlowExecutionState;
  }

  async findAll(): Promise<IFlowExecutionState[]> {
    const snapshot = await this.db.collection('flows_execution_state').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as IFlowExecutionState);
  }
}
