import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, PiggyBank, Target, Calendar, TrendingUp, Plus, Home, MapPin, Car, Maximize2, Tag, Search, X, Filter, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

interface Property {
  id: string;
  nome: string;
  imagem: string;
  valor: string;
  m2: string;
  localizacao: string;
  link: string;
  quartos: string;
  gartos: string;
  garagem: string;
  valorNumerico?: number;
  distancia?: number;
  tags?: string[];
}

interface SavingsGoal {
  propertyId: string;
  targetDate: string;
  currentSavings: number;
}

export default function Cofrinho() {
  const [likedProperties, setLikedProperties] = useState<Property[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>([]);
    const [addMoneyAmount, setAddMoneyAmount] = useState("");
  const [isAddMoneyOpen, setIsAddMoneyOpen] = useState(false);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [filteredProperties, setFilteredProperties] = useState<Property[]>([]);

  useEffect(() => {
    const savedLiked = localStorage.getItem('likedProperties');
    const savedSavings = localStorage.getItem('totalSavings');
        const savedGoals = localStorage.getItem('savingsGoals');
    const savedTags = localStorage.getItem('availableTags');
    
    if (savedLiked) {
      try {
        setLikedProperties(JSON.parse(savedLiked));
      } catch (error) {
        console.error('Error loading liked properties:', error);
      }
    }
    
    if (savedSavings) {
      setTotalSavings(parseFloat(savedSavings));
    }
    
        if (savedGoals) {
      try {
        setSavingsGoals(JSON.parse(savedGoals));
      } catch (error) {
        console.error('Error loading savings goals:', error);
      }
    }

    if (savedTags) {
      try {
        setAvailableTags(JSON.parse(savedTags));
      } catch (error) {
        console.error('Error loading available tags:', error);
      }
    }
  }, []);

  // Filter properties based on selected tags
  useEffect(() => {
    if (tagFilter.length === 0) {
      setFilteredProperties(likedProperties);
    } else {
      const filtered = likedProperties.filter(property =>
        property.tags && tagFilter.some(tag => property.tags!.includes(tag))
      );
      setFilteredProperties(filtered);
    }
  }, [likedProperties, tagFilter]);

  const parseNumericValue = (valueStr: string): number => {
    return parseInt(valueStr.replace(/[^\d]/g, '')) || 0;
  };

  const addMoney = () => {
    const amount = parseFloat(addMoneyAmount.replace(/[^\d.]/g, ''));
    if (amount > 0) {
      const newTotal = totalSavings + amount;
      setTotalSavings(newTotal);
      localStorage.setItem('totalSavings', newTotal.toString());
      toast.success(`R$ ${amount.toLocaleString()} adicionado ao cofrinho!`);
      setAddMoneyAmount("");
      setIsAddMoneyOpen(false);
    } else {
      toast.error("Digite um valor válido");
    }
  };

  const setTargetDate = (propertyId: string, targetDate: string) => {
    const updatedGoals = savingsGoals.filter(g => g.propertyId !== propertyId);
    updatedGoals.push({
      propertyId,
      targetDate,
      currentSavings: totalSavings
    });
    setSavingsGoals(updatedGoals);
    localStorage.setItem('savingsGoals', JSON.stringify(updatedGoals));
    toast.success("Meta de data definida!");
  };

  const calculateDownPayment = (valorStr: string): number => {
    const valor = parseNumericValue(valorStr);
    return valor * 0.3; // 30% down payment
  };

  const calculateMonthlyNeeded = (propertyId: string, valor: string): number => {
    const goal = savingsGoals.find(g => g.propertyId === propertyId);
    if (!goal || !goal.targetDate) return 0;
    
    const downPayment = calculateDownPayment(valor);
    const remaining = downPayment - totalSavings;
    
    if (remaining <= 0) return 0;
    
    const targetDate = new Date(goal.targetDate);
    const today = new Date();
    const monthsRemaining = Math.max(1, Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30)));
    
    return remaining / monthsRemaining;
  };

    const getProgressPercentage = (valor: string): number => {
    const downPayment = calculateDownPayment(valor);
    return Math.min(100, (totalSavings / downPayment) * 100);
  };

  const removeFromLiked = (propertyId: string) => {
    const updatedLiked = likedProperties.filter(p => p.id !== propertyId);
    setLikedProperties(updatedLiked);
    localStorage.setItem('likedProperties', JSON.stringify(updatedLiked));
    toast.success("Casa removida das curtidas!");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-blue-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-6 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
            <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
              <Link to="/">
                <Button variant="outline" size="sm" className="gap-1 sm:gap-2 text-xs sm:text-sm">
                  <ArrowLeft className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden xs:inline">Voltar</span>
                </Button>
              </Link>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-green-600 rounded-lg">
                  <PiggyBank className="h-5 w-5 sm:h-6 sm:w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900">Cofrinho</h1>
                  <p className="text-xs sm:text-sm text-gray-600 hidden xs:block">Suas economias para o lar dos sonhos</p>
                </div>
              </div>
            </div>
            
            <Dialog open={isAddMoneyOpen} onOpenChange={setIsAddMoneyOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-green-600 hover:bg-green-700">
                  <Plus className="h-4 w-4" />
                  Adicionar Dinheiro
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Adicionar ao Cofrinho</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="amount">Valor (R$)</Label>
                    <Input
                      id="amount"
                      placeholder="Ex: 1000"
                      value={addMoneyAmount}
                      onChange={(e) => setAddMoneyAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button onClick={addMoney} className="flex-1">
                      Adicionar
                    </Button>
                    <Button variant="outline" onClick={() => setIsAddMoneyOpen(false)}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 sm:px-6 py-6 sm:py-8">
                {/* Tag Filter */}
        {availableTags.length > 0 && (
          <Card className="mb-8 bg-white/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtrar por Tags
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1 min-h-[2rem] p-2 border rounded-md bg-white">
                  {tagFilter.length === 0 ? (
                    <span className="text-sm text-gray-400">Selecione tags para filtrar suas casas curtidas</span>
                  ) : (
                    tagFilter.map(tag => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="cursor-pointer hover:bg-red-100"
                        onClick={() => setTagFilter(prev => prev.filter(t => t !== tag))}
                      >
                        {tag} <X className="h-3 w-3 ml-1" />
                      </Badge>
                    ))
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableTags.filter(tag => !tagFilter.includes(tag)).map(tag => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="cursor-pointer hover:bg-blue-50"
                      onClick={() => setTagFilter(prev => [...prev, tag])}
                    >
                      <Plus className="h-3 w-3 mr-1" /> {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Savings Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Total Poupado</p>
                  <p className="text-3xl font-bold text-green-600">
                    R$ {totalSavings.toLocaleString()}
                  </p>
                </div>
                <PiggyBank className="h-8 w-8 text-green-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                                <div>
                  <p className="text-sm font-medium text-gray-600">Casas Curtidas</p>
                  <p className="text-3xl font-bold text-blue-600">
                    {filteredProperties.length}
                    {tagFilter.length > 0 && filteredProperties.length !== likedProperties.length && (
                      <span className="text-lg text-gray-500">/{likedProperties.length}</span>
                    )}
                  </p>
                </div>
                <Home className="h-8 w-8 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-600">Metas Ativas</p>
                  <p className="text-3xl font-bold text-purple-600">{savingsGoals.length}</p>
                </div>
                <Target className="h-8 w-8 text-purple-600" />
              </div>
            </CardContent>
          </Card>
        </div>

                {/* Properties Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProperties.map((property) => {
            const downPayment = calculateDownPayment(property.valor);
            const progress = getProgressPercentage(property.valor);
            const monthlyNeeded = calculateMonthlyNeeded(property.id, property.valor);
            const goal = savingsGoals.find(g => g.propertyId === property.id);
            
            return (
              <Card key={property.id} className="overflow-hidden bg-white/80 backdrop-blur-sm hover:shadow-lg transition-all duration-300">
                <div className="relative">
                  <img
                    src={property.imagem}
                    alt={property.nome}
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&h=300&fit=crop";
                    }}
                  />
                  <Badge className="absolute top-3 right-3 bg-green-600">
                    {progress.toFixed(0)}% Poupado
                  </Badge>
                </div>
                
                <CardContent className="p-6">
                  <h3 className="font-bold text-lg text-gray-900 mb-2 line-clamp-2">
                    {property.nome}
                  </h3>
                  
                  <div className="flex items-center gap-2 mb-3">
                    <MapPin className="h-4 w-4 text-gray-500" />
                    <p className="text-sm text-gray-600 line-clamp-1">{property.localizacao}</p>
                  </div>
                  
                  <div className="space-y-3 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Valor Total:</span>
                      <span className="font-bold text-blue-600">{property.valor}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Entrada (30%):</span>
                      <span className="font-bold text-orange-600">
                        R$ {downPayment.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">Falta:</span>
                      <span className="font-bold text-red-600">
                        R$ {Math.max(0, downPayment - totalSavings).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="mb-4">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                  
                                    <div className="flex flex-wrap gap-2 mb-4">
                    <Badge variant="secondary" className="gap-1">
                      <Maximize2 className="h-3 w-3" />
                      {property.m2}
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <Home className="h-3 w-3" />
                      {property.quartos}
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <Car className="h-3 w-3" />
                      {property.garagem} vagas
                    </Badge>
                  </div>

                  {/* Tags */}
                  {property.tags && property.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-4">
                      {property.tags.map(tag => (
                        <Badge key={tag} variant="default" className="text-xs bg-purple-100 text-purple-800">
                          <Tag className="h-3 w-3 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Target Date and Monthly Calculation */}
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        type="date"
                        placeholder="Meta de data"
                        value={goal?.targetDate || ""}
                        onChange={(e) => setTargetDate(property.id, e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    
                    {goal?.targetDate && monthlyNeeded > 0 && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <TrendingUp className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium text-blue-900">Meta Mensal</span>
                        </div>
                        <p className="text-lg font-bold text-blue-600">
                          R$ {monthlyNeeded.toLocaleString()}
                        </p>
                        <p className="text-xs text-blue-700">
                          para alcançar a entrada até {new Date(goal.targetDate).toLocaleDateString()}
                        </p>
                      </div>
                    )}
                    
                                        <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeFromLiked(property.id)}
                        className="gap-2"
                      >
                        <Trash2 className="h-4 w-4" />
                        Remover
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => window.open(property.link, '_blank')}
                      >
                        Ver Detalhes
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

                {filteredProperties.length === 0 && likedProperties.length === 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <PiggyBank className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhuma casa curtida ainda
              </h3>
              <p className="text-gray-600 mb-6">
                Comece curtindo algumas casas para começar a planejar suas economias
              </p>
              <Link to="/">
                <Button className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar para a busca
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {filteredProperties.length === 0 && likedProperties.length > 0 && (
          <Card className="bg-white/60 backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <Search className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                Nenhuma casa encontrada com essas tags
              </h3>
              <p className="text-gray-600 mb-6">
                Tente ajustar os filtros. Você tem {likedProperties.length} casas curtidas.
              </p>
              <Button variant="outline" onClick={() => setTagFilter([])}>
                Limpar Filtros
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
