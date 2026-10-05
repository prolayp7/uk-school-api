import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, resolve, sep } from "node:path";

@Injectable()
export class FileStorageService {
  private rootDirectory(): string {
    const configured = process.env.FILE_STORAGE_DIR?.trim();
    if (!configured) {
      throw new ServiceUnavailableException("FILE_STORAGE_DIR is not configured.");
    }
    if (!isAbsolute(configured)) {
      throw new InternalServerErrorException("FILE_STORAGE_DIR must be an absolute path.");
    }

    const root = resolve(configured);
    const workspaceDirectory = dirname(resolve(process.cwd()));
    const siblingProjectRoots = readdirSync(workspaceDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(workspaceDirectory, entry.name))
      .filter((directory) => existsSync(join(directory, "package.json")) || existsSync(join(directory, ".git")));
    const projectRoots = [resolve(process.cwd()), ...siblingProjectRoots];
    const contains = (parent: string, child: string) => child === parent || child.startsWith(`${parent}${sep}`);
    if (projectRoots.some((projectRoot) => contains(projectRoot, root) || contains(root, projectRoot))) {
      throw new InternalServerErrorException("FILE_STORAGE_DIR must be outside application repositories.");
    }
    return root;
  }

  async saveFile(category: string, originalName: string, contents: Buffer): Promise<string> {
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/i.test(category)) {
      throw new BadRequestException("Invalid file storage category.");
    }

    const extension = extname(originalName).toLowerCase();
    if (extension && !/^\.[a-z0-9]{1,10}$/.test(extension)) {
      throw new BadRequestException("Invalid file extension.");
    }

    const root = this.rootDirectory();
    const directory = resolve(root, category);
    if (!directory.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("Invalid file storage category.");
    }
    await mkdir(directory, { recursive: true });
    const key = `${category}/${randomUUID()}${extension}`;
    await writeFile(resolve(root, key), contents, { flag: "wx" });
    return key;
  }

  async saveTemporaryFile(originalName: string, contents: Buffer): Promise<string> {
    return this.saveFile("tmp", originalName, contents);
  }

  async readFile(key: string): Promise<Buffer> {
    const root = this.rootDirectory();
    const absolutePath = resolve(root, key);
    if (!absolutePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("Invalid stored file key.");
    }
    return readFile(absolutePath);
  }

  async deleteFile(key: string): Promise<void> {
    const root = this.rootDirectory();
    const absolutePath = resolve(root, key);
    if (!absolutePath.startsWith(`${root}${sep}`)) {
      throw new BadRequestException("Invalid stored file key.");
    }
    await rm(absolutePath, { force: true });
  }
}