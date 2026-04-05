import { Body, Controller, Param, Sse, MessageEvent, Post, Get, Put, Query, UseFilters } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { AddNodesDto, WebhookNodeDto } from '../models/creative-flowboard.dto';
import { CreativeFlowboardService } from '../services/creative-flowboard.service';
import { FlowEventsService } from '../services/flow-events.service';
import { Observable } from 'rxjs';
import { CreativeFlowboardDocument } from '../schemas/creative-flowboard.schema';
import { EntityController, EntityMongoController } from '@dataclouder/nest-mongo';
import { AllExceptionsHandler } from '@dataclouder/nest-core';

/**
 * Controller for handling HTTP requests related to agentFlows entities
 * Provides REST API endpoints for CRUD operations on agentFlows entities
 */
@ApiTags('CreativeFlowboard')
@Controller('api/creative-flowboard')
@UseFilters(AllExceptionsHandler)
export class CreativeFlowboardController extends EntityMongoController<CreativeFlowboardDocument> {
  constructor(
    private readonly creativeFlowboardService: CreativeFlowboardService,
    private readonly flowEventsService: FlowEventsService
  ) {
    super(creativeFlowboardService);
  }

  @Sse('subscribe/:id')
  subscribe(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable(observer => {
      const handler = data => {
        observer.next({ data });
      };
      this.flowEventsService.subscribe(id, handler);
      // Clean up when the client disconnects
      return () => this.flowEventsService.unsubscribe(id, handler);
    });
  }



  @Post('run/:id')
  @ApiOperation({ summary: 'Run a full flowboard, all process nodes existing in the flowboard will be executed.' })
  @ApiResponse({ status: 200, description: 'Return the entired flow result.' })
  async run(@Param('id') id: string): Promise<any> {
    return await this.creativeFlowboardService.runFlow(id);
  }

  @Post('run-node')
  @ApiOperation({ summary: 'Run a single node of the flowboard passed by body nodeId' })
  @ApiResponse({ status: 200, description: 'Return the node result.' })
  async runNodePost(@Body() body: { flowId: string; nodeId: string }): Promise<any> {
    return await this.creativeFlowboardService.runNodev2(body.flowId, body.nodeId);
  }

  // Diference with Post, this is intended to query for other services and it waits for the response.
  // TODO: teminar el método, probablemente no necesite guardar en la base de datos y tampoco lo de firebase, entonces modificar métodos para hacer una versión corta.
  @Get('run-node')
  @ApiOperation({ summary: 'Run a node, for external services that need to wait for the response. of the flowboard passed by query parameters flowId and nodeId' })
  @ApiResponse({ status: 200, description: 'Return the node result.' })
  async runNode(@Query('flowId') flowId: string, @Query('nodeId') nodeId: string): Promise<any> {
    return await this.creativeFlowboardService.runAndWait(flowId, nodeId);
  }

  @Post('webhook/node')
  @ApiOperation({ summary: 'Run a node of a newComponent item' })
  @ApiResponse({ status: 200, description: 'Return the newComponent item.' })
  @ApiBody({ type: WebhookNodeDto })
  async startWebhookNode(@Body() body: WebhookNodeDto): Promise<any> {
    console.log('startWebhookNode() -> ', body);
    const results = await this.creativeFlowboardService.runTaskNode(body);
    return results;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Save the full canvas and broadcast SYNC_CANVAS to all subscribers' })
  async saveCanvas(@Param('id') id: string, @Body() body: any): Promise<any> {
    const result = await this.creativeFlowboardService.saveCanvas(id, body);
    this.flowEventsService.emit(id, { event: 'SYNC_CANVAS', payload: result });
    return result;
  }

  @Post('add-nodes')
  @ApiOperation({ summary: 'Add nodes and edges to a flow' })
  @ApiResponse({ status: 200, description: 'Return the updated flow.' })
  @ApiBody({ type: AddNodesDto })
  async addNodes(@Body() body: AddNodesDto): Promise<any> {
    return await this.creativeFlowboardService.addNodes(body);
  }
}
