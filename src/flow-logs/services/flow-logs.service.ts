import { Injectable } from '@nestjs/common';
import { FlowLogs, StatusJob } from '../models/models';
import * as admin from 'firebase-admin';
import { ObjectId } from 'mongodb';

@Injectable()
export class AutomationLogsService {
  private db: admin.firestore.Firestore;

  constructor() {
    if (admin.apps.length === 0) {
      console.warn('Firebase Admin SDK not initialized. Attempting default initialization.');
    }
    this.db = admin.firestore();
  }

  async buildAndSave(firstValues: Partial<FlowLogs> = {}): Promise<FlowLogs> {
    const log = this.buildNewLog();
    await this.create({ ...log, ...firstValues });
    return log;
  }

  buildNewLog(): FlowLogs {
    const id = new ObjectId().toString();
    return {
      id,
      status: StatusJob.PENDING,
      nodes: {},
    };
  }

  async create(log: FlowLogs): Promise<FlowLogs> {
    const logRef = this.db.collection('flow_logs').doc(log.id);
    await logRef.set({
      ...log,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const snapshot = await logRef.get();
    return snapshot.data() as FlowLogs;
  }

  async update(id: string, partialLog: Partial<FlowLogs>): Promise<FlowLogs> {
    const logRef = this.db.collection('flow_logs').doc(id);
    await logRef.update({
      ...partialLog,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    const snapshot = await logRef.get();
    return snapshot.data() as FlowLogs;
  }

  async updateCounts(success: boolean, description: string, partialLog: FlowLogs): Promise<FlowLogs> {
    console.log('partialLog', partialLog);
    return partialLog;
  }

  async findOne(id: string): Promise<FlowLogs | null> {
    const logRef = this.db.collection('flow_logs').doc(id);
    const snapshot = await logRef.get();
    if (!snapshot.exists) {
      return null;
    }
    return snapshot.data() as FlowLogs;
  }

  async findAll(): Promise<FlowLogs[]> {
    const snapshot = await this.db.collection('flow_logs').orderBy('createdAt', 'desc').get();
    return snapshot.docs.map(doc => doc.data() as FlowLogs);
  }
}
