import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { CensusController } from "./census.controller";
import { CensusService } from "./census.service";

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CensusController],
  providers: [CensusService],
})
export class CensusModule {}
