import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KeyBalancerService } from './key-balancer.service';

@Module({
  imports: [HttpModule],
  providers: [KeyBalancerService],
  exports: [KeyBalancerService],
})
export class KeyBalancerModule {}
