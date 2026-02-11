import { FlowStateService } from '../services/flow-state.service';
import { FlowNodeSearchesService } from '../services/flow-searches.service';
import { ICreativeFlowBoard, NodeType, StatusJob } from '../models/creative-flowboard.models';

function testConsolidation() {
  console.log('Starting FlowStateService unit test...');

  const searchesService = new FlowNodeSearchesService();
  const flowStateService = new FlowStateService(searchesService);

  const mockFlow: ICreativeFlowBoard = {
    id: 'test-flow',
    orgId: 'test-org',
    nodes: [
      {
        id: 'image-node',
        point: { x: 0, y: 0 },
        type: NodeType.AssetsNodeComponent,
        config: { component: NodeType.AssetsNodeComponent, category: 'input' as any },
        data: {
          nodeData: {
            storage: { url: 'http://example.com/image.jpg' }
          }
        }
      },
      {
        id: 'audio-node',
        point: { x: 0, y: 100 },
        type: NodeType.AudioNodeComponent,
        config: { component: NodeType.AudioNodeComponent, category: 'input' as any },
        data: {
          nodeData: {
            storage: { url: 'http://example.com/audio.mp3' }
          }
        }
      },
      {
        id: 'video-gen-node',
        point: { x: 200, y: 50 },
        type: NodeType.VideoGenNodeComponent,
        config: { component: NodeType.VideoGenNodeComponent, category: 'process' as any },
        data: {
          nodeData: {
            workflow: 'image-audio-to-video',
            provider: 'veo',
            prompt: 'A cinematic video of a sunset'
          }
        }
      }
    ],
    edges: [
      { id: 'e1', source: 'image-node', target: 'video-gen-node', markers: [], edgeLabels: {} },
      { id: 'e2', source: 'audio-node', target: 'video-gen-node', markers: [], edgeLabels: {} }
    ],
    metadata: {}
  };

  const state = flowStateService.createInitialState(mockFlow);
  const videoTask = state.tasks.find(t => t.processNodeId === 'video-gen-node');

  if (!videoTask) {
    throw new Error('Video task not found');
  }

  console.log(`Number of jobs for video task: ${videoTask.jobs.length}`);
  if (videoTask.jobs.length !== 1) {
    throw new Error(`Expected 1 job, got ${videoTask.jobs.length}`);
  }

  const job = videoTask.jobs[0];
  console.log(`Job inputNodeIds: ${JSON.stringify(job.inputNodeIds)}`);
  if (!job.inputNodeIds || job.inputNodeIds.length !== 2) {
    throw new Error('Job inputNodeIds not correctly populated');
  }

  if (job.processNodeType !== NodeType.VideoGenNodeComponent) {
      throw new Error(`Expected processNodeType to be VideoGenNodeComponent, got ${job.processNodeType}`);
  }

  console.log('Unit test passed successfully!');
}

try {
  testConsolidation();
} catch (error) {
  console.error('Unit test failed:', error.message);
  process.exit(1);
}
