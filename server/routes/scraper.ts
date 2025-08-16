import { Express } from 'express';
import { exec, spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx';

interface ScrapingStatus {
  isRunning: boolean;
  progress: string;
  startTime?: Date;
  lastUpdate?: Date;
  error?: string;
  completed: boolean;
  totalProperties?: number;
}

interface UserData {
  likedProperties: any[];
  dislikedProperties: any[];
  cofrinho: any[];
  lastUpdate: Date;
}

let scrapingStatus: ScrapingStatus = {
  isRunning: false,
  progress: 'Pausado',
  completed: false
};

let scrapingProcess: ChildProcess | null = null;
const DATA_DIR = './server/data';
const SCRAPER_OUTPUT = './imoveis_consolidado.xlsx';

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load user data from JSON
async function loadUserData(userId: string = 'default'): Promise<UserData> {
  try {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, `${userId}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Return default data if file doesn't exist
    return {
      likedProperties: [],
      dislikedProperties: [],
      cofrinho: [],
      lastUpdate: new Date()
    };
  }
}

// Save user data to JSON
async function saveUserData(userId: string = 'default', data: UserData): Promise<void> {
  try {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, `${userId}.json`);
    data.lastUpdate = new Date();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving user data:', error);
    throw error;
  }
}

// Read Excel file and convert to JSON
async function readExcelFile(filePath: string): Promise<any[]> {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    
    // Convert to property format
    return jsonData.map((row: any, index: number) => ({
      id: `scraped-${Date.now()}-${index}`,
      nome: row.Nome || row.nome || `Imóvel ${index + 1}`,
      imagem: row.Imagem || row.imagem || "https://cdn.builder.io/api/v1/image/assets%2FTEMP%2Fdefault-house",
      imagem2: row.Imagem2 || row.imagem2 || "",
      valor: row.Valor || row.valor || "R$ 0",
      condominio: row.Condominio || row.condominio || "",
      m2: row['M²'] || row.m2 || "0 m²",
      rua: row.Rua || row.rua || "",
      bairro: row.Bairro || row.bairro || "",
      localizacao: row['Localização'] || row.localizacao || "Localização não informada",
      link: row.Link || row.link || "#",
      quartos: row.Quartos || row.quartos || "0 quartos",
      garagem: row.Vagas || row.garagem || "0",
      banheiros: row.Banheiros || row.banheiros || "",
      vantagens: row.Vantagens || row.vantagens || "",
      palavrasChaves: row.PalavrasChave || row.palavrasChaves || "",
      site: row.Fonte || row.fonte || row.Site || row.site || "Scraper"
    }));
  } catch (error) {
    console.error('Error reading Excel file:', error);
    throw error;
  }
}

export function setupScraperRoutes(app: Express) {
  // Start scraping
  app.post('/api/scraper/start', async (req, res) => {
    if (scrapingStatus.isRunning) {
      return res.status(400).json({ error: 'Scraping already in progress' });
    }

    try {
      scrapingStatus = {
        isRunning: true,
        progress: 'Iniciando scraping...',
        startTime: new Date(),
        lastUpdate: new Date(),
        completed: false
      };

      // Execute Python scraper script
      scrapingProcess = spawn('python', ['scraper_unificado.py'], {
        cwd: './server',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let outputBuffer = '';

      scrapingProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        outputBuffer += output;
        
        // Extract progress information from output
        const lines = output.split('\n');
        const lastLine = lines[lines.length - 2] || lines[lines.length - 1];
        if (lastLine && lastLine.trim()) {
          scrapingStatus.progress = lastLine.trim();
          scrapingStatus.lastUpdate = new Date();
        }
      });

      scrapingProcess.stderr?.on('data', (data) => {
        console.error('Scraper stderr:', data.toString());
        scrapingStatus.error = data.toString();
      });

      scrapingProcess.on('close', async (code) => {
        scrapingStatus.isRunning = false;
        scrapingStatus.completed = true;
        scrapingStatus.lastUpdate = new Date();
        
        if (code === 0) {
          scrapingStatus.progress = 'Scraping concluído com sucesso!';
          
          // Try to count properties from generated file
          try {
            const properties = await readExcelFile(SCRAPER_OUTPUT);
            scrapingStatus.totalProperties = properties.length;
            scrapingStatus.progress = `Scraping concluído! ${properties.length} imóveis coletados.`;
          } catch (error) {
            console.error('Error reading output file:', error);
          }
        } else {
          scrapingStatus.progress = `Scraping finalizado com erro (código: ${code})`;
          scrapingStatus.error = `Process exited with code ${code}`;
        }
        
        scrapingProcess = null;
      });

      res.json({ message: 'Scraping iniciado', status: scrapingStatus });
    } catch (error) {
      scrapingStatus.isRunning = false;
      scrapingStatus.error = error instanceof Error ? error.message : 'Erro desconhecido';
      res.status(500).json({ error: 'Erro ao iniciar scraping', details: scrapingStatus.error });
    }
  });

  // Stop scraping
  app.post('/api/scraper/stop', (req, res) => {
    if (scrapingProcess) {
      scrapingProcess.kill('SIGTERM');
      scrapingStatus.isRunning = false;
      scrapingStatus.progress = 'Scraping interrompido pelo usuário';
      scrapingStatus.lastUpdate = new Date();
      res.json({ message: 'Scraping interrompido', status: scrapingStatus });
    } else {
      res.status(400).json({ error: 'Nenhum processo de scraping ativo' });
    }
  });

  // Get scraping status
  app.get('/api/scraper/status', (req, res) => {
    res.json(scrapingStatus);
  });

  // Import scraped data
  app.post('/api/scraper/import', async (req, res) => {
    try {
      // Check if output file exists
      const fileExists = await fs.access(SCRAPER_OUTPUT).then(() => true).catch(() => false);
      if (!fileExists) {
        return res.status(404).json({ error: 'Arquivo de dados não encontrado' });
      }

      // Read and return the Excel data
      const properties = await readExcelFile(SCRAPER_OUTPUT);
      res.json({ 
        message: `${properties.length} imóveis importados do scraping`,
        properties,
        count: properties.length
      });
    } catch (error) {
      console.error('Error importing scraped data:', error);
      res.status(500).json({ error: 'Erro ao importar dados do scraping' });
    }
  });

  // Save user data (liked, disliked, cofrinho)
  app.post('/api/user/:userId/data', async (req, res) => {
    try {
      const { userId } = req.params;
      const { likedProperties, dislikedProperties, cofrinho } = req.body;
      
      const userData: UserData = {
        likedProperties: likedProperties || [],
        dislikedProperties: dislikedProperties || [],
        cofrinho: cofrinho || [],
        lastUpdate: new Date()
      };

      await saveUserData(userId, userData);
      res.json({ message: 'Dados salvos com sucesso', lastUpdate: userData.lastUpdate });
    } catch (error) {
      console.error('Error saving user data:', error);
      res.status(500).json({ error: 'Erro ao salvar dados do usuário' });
    }
  });

  // Load user data
  app.get('/api/user/:userId/data', async (req, res) => {
    try {
      const { userId } = req.params;
      const userData = await loadUserData(userId);
      res.json(userData);
    } catch (error) {
      console.error('Error loading user data:', error);
      res.status(500).json({ error: 'Erro ao carregar dados do usuário' });
    }
  });

  // Update specific user data (liked properties)
  app.post('/api/user/:userId/liked', async (req, res) => {
    try {
      const { userId } = req.params;
      const { property } = req.body;
      
      const userData = await loadUserData(userId);
      
      // Add to liked if not already there
      if (!userData.likedProperties.find(p => p.id === property.id)) {
        userData.likedProperties.push(property);
      }
      
      // Remove from disliked if present
      userData.dislikedProperties = userData.dislikedProperties.filter(p => p.id !== property.id);
      
      await saveUserData(userId, userData);
      res.json({ message: 'Propriedade curtida salva', userData });
    } catch (error) {
      console.error('Error saving liked property:', error);
      res.status(500).json({ error: 'Erro ao salvar propriedade curtida' });
    }
  });

  // Update disliked properties
  app.post('/api/user/:userId/disliked', async (req, res) => {
    try {
      const { userId } = req.params;
      const { property } = req.body;
      
      const userData = await loadUserData(userId);
      
      // Add to disliked if not already there
      if (!userData.dislikedProperties.find(p => p.id === property.id)) {
        userData.dislikedProperties.push(property);
      }
      
      // Remove from liked if present
      userData.likedProperties = userData.likedProperties.filter(p => p.id !== property.id);
      
      await saveUserData(userId, userData);
      res.json({ message: 'Propriedade rejeitada salva', userData });
    } catch (error) {
      console.error('Error saving disliked property:', error);
      res.status(500).json({ error: 'Erro ao salvar propriedade rejeitada' });
    }
  });

  // Update cofrinho
  app.post('/api/user/:userId/cofrinho', async (req, res) => {
    try {
      const { userId } = req.params;
      const { property } = req.body;
      
      const userData = await loadUserData(userId);
      
      // Add to cofrinho if not already there
      if (!userData.cofrinho.find(p => p.id === property.id)) {
        userData.cofrinho.push(property);
      }
      
      await saveUserData(userId, userData);
      res.json({ message: 'Propriedade adicionada ao cofrinho', userData });
    } catch (error) {
      console.error('Error saving cofrinho property:', error);
      res.status(500).json({ error: 'Erro ao salvar no cofrinho' });
    }
  });
}
