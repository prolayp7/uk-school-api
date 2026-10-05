import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { BehaviourController, SafeguardingController } from "./behaviour.controller";
import { BehaviourService } from "./behaviour.service";
import { SafeguardingService } from "./safeguarding.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [BehaviourController, SafeguardingController],
  providers: [BehaviourService, SafeguardingService],
})
export class BehaviourModule {}
