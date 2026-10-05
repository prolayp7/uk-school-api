import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async isReady(): Promise<boolean> {
    return this.prisma.isDatabaseReady();
  }
}
