import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ErpController } from "./erp.controller";
import { ErpService } from "./erp.service";

@Module({
  imports: [AuthModule],
  controllers: [ErpController],
  providers: [ErpService],
})
export class ErpModule {}
